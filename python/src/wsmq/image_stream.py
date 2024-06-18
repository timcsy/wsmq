# Note: Only support VP9 now
import av
import threading
import queue
import struct
import time
import io
import json
import numpy as np
from PIL import Image
import cv2
from wsmq import WebSocketMQClient

class ImageStream:
    def __init__(self, url='ws://localhost:6789', buffer_size=1):
        self.url = url
        self.buffer_size = buffer_size
        self.queues = {}  # Queues for storing frames for different topics
        self.frames = {}  # Current frames for different topics
        self.metadata = {}  # Metadata for different topics
        self.stop_event = threading.Event()
        self.client = WebSocketMQClient(url=url)
        self.subscribers_ready = {}  # Events for managing subscribers for different topics
        self.decoders = {}  # Decoders for different topics
        self.encoders = {}  # Encoders for different topics
        self.on_receives = {}  # key: topic, value: (callback function (topic, image), image_format)

    def on_message(self, topic, payload, props):
        content_type = props.get('content_type', '')

        if content_type == 'application/json':  # Metadata
            metadata = json.loads(payload)
            self.metadata[topic] = metadata
            self.subscribers_ready[topic] = threading.Event()
            self.initialize_decoder(topic)
        elif content_type == 'video/encoded':  # Video frame
            is_keyframe = bool(struct.unpack('!B', payload[0:1])[0])
            if is_keyframe:
                self.subscribers_ready[topic].set()
            if self.subscribers_ready.get(topic, threading.Event()).is_set():
                packet = av.packet.Packet(payload[1:])
                if topic not in self.decoders:
                    self.initialize_decoder(topic)
                decoder = self.decoders[topic]
                try:
                    for frame in decoder.decode(packet):
                        self.frames[topic] = frame
                        on_receive, image_format = self.on_receives.get(topic, (None, 'PIL'))
                        if on_receive is not None:
                            image = self.convert_frame(frame, image_format)
                            on_receive(topic, image)
                except av.AVError as e:
                    print(f"Error decoding packet: {e}")

    def convert_frame(self, frame, image_format):
        '''
        Convert frame to specified image format
        image_format = None, 'ndarray', 'opencv', 'PIL'
        '''
        ndarray = frame.to_ndarray(format='rgb24')
        if image_format == 'ndarray':
            return ndarray
        elif image_format == 'opencv':
            return cv2.cvtColor(ndarray, cv2.COLOR_RGB2BGR)
        elif image_format == 'PIL':
            return Image.fromarray(ndarray)
        else:
            raise ValueError(f"Unsupported image format: {image_format}")

    def initialize_encoder(self, topic, metadata):
        '''
        Initialize encoder for the given topic
        '''
        codec_name = 'vp9'
        container = av.open(io.BytesIO(), mode='w', format='webm')
        stream = container.add_stream(codec_name, rate=metadata.get('frame_rate', 30))
        stream.width = metadata.get('width', 640)
        stream.height = metadata.get('height', 480)
        stream.pix_fmt = metadata.get('pix_fmt', 'yuv420p')
        stream.codec_context.gop_size = metadata.get('gop_size', 50)  # Set keyframe interval in frames or called GOP size
        stream.codec_context.options = {'lag-in-frames': '0'} # zero latency
        self.encoders[topic] = stream

    def initialize_decoder(self, topic):
        '''
        Initialize decoder for the given topic
        '''
        if topic in self.decoders:
            del self.decoders[topic]
        codec_name = 'vp9'
        self.decoders[topic] = av.codec.CodecContext.create(codec_name, 'r')

    def encode_frame(self, frame, topic):
        '''
        Encode frame and return packets
        '''
        metadata = self.metadata.get(topic)
        if metadata is None:
            raise ValueError(f"No metadata available for topic {topic}")

        if topic not in self.encoders:
            self.initialize_encoder(topic, metadata)
        stream = self.encoders[topic]

        frame = av.VideoFrame.from_ndarray(frame, format='bgr24')
        packets = stream.encode(frame)
        keyframes = [pkt for pkt in packets if pkt.is_keyframe]
        if keyframes:
            # Let the latter peer get the metadata if encounter key frame
            metadata_json = json.dumps(metadata)
            self.client.publish(topic, metadata_json, content_type='application/json')
        return packets

    def send_frame(self):
        '''
        Thread function to send frames
        '''
        while not self.stop_event.is_set():
            for topic in list(self.queues):
                if topic in self.queues and not self.queues[topic].empty():
                    frame = self.queues[topic].get()
                    packets = self.encode_frame(frame, topic)
                    for packet in packets:
                        self.client.publish(topic, struct.pack('!B', packet.is_keyframe) + bytes(packet), content_type='video/encoded')
            time.sleep(0.001)

    def start(self):
        '''
        Start the client and the frame sending thread
        '''
        self.client.connect()
        time.sleep(0.5)
        self.thread = threading.Thread(target=self.send_frame, daemon=True)
        self.thread.start()

    def stop(self):
        '''
        Stop the frame sending thread and disconnect the client
        '''
        self.stop_event.set()
        self.thread.join()
        self.client.disconnect()
    
    def subscribe(self, topic, on_receive=None, image_format='PIL'):
        '''
        Subscribe to a topic with a callback function and image format
        image_format = None, 'ndarray', 'opencv', 'PIL'
        '''
        if on_receive is not None:
            self.on_receives[topic] = (on_receive, image_format)
        self.client.subscribe(topic, lambda t, p, props: self.on_message(t, p, props))
    
    def unsubscribe(self, topic):
        '''
        Unsubscribe from a topic
        '''
        if topic in self.on_receives:
            del self.on_receives[topic]
        self.client.unsubscribe(topic)

    def publish(self, topic, metadata):
        '''
        Publish metadata for the given topic
        '''
        self.metadata[topic] = metadata
        if topic in self.encoders:
            del self.encoders[topic]
        metadata_json = json.dumps(metadata)
        self.client.publish(topic, metadata_json, content_type='application/json')

    def add_image(self, topic, image, image_format=None):
        '''
        Add image to the queue for the given topic
        image_format = None, 'ndarray', 'opencv', 'PIL'
        '''
        if isinstance(image, Image.Image):
            image = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
        elif isinstance(image, np.ndarray):
            if image.ndim == 2:
                image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
            elif image.shape[2] == 3:
                if image_format != 'opencv':
                    image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
            elif image.shape[2] == 4:
                if image_format == 'opencv':
                    image = cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)
                elif image_format == 'ndarray':
                    image = cv2.cvtColor(image, cv2.COLOR_RGBA2BGR)
        elif isinstance(image, bytes):
            nparr = np.frombuffer(image, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if topic not in self.queues:
            self.queues[topic] = queue.Queue(maxsize=self.buffer_size)
        if self.queues[topic].full():
            self.queues[topic].get()
        self.queues[topic].put(image)

    def get_image(self, topic, image_format=None):
        '''
        Get the current frame for the given topic
        image_format = None, 'ndarray', 'opencv', 'PIL'
        '''
        frame = self.frames.get(topic)
        if frame:
            if image_format is None: # Original frame
                return frame
            elif image_format == 'ndarray': # NumPy array (RGB)
                return frame.to_ndarray(format='rgb24')
            elif image_format == 'opencv': # OpenCV image (BGR)
                return frame.to_ndarray(format='bgr24')
            elif image_format == 'PIL': # PIL image
                return Image.fromarray(frame.to_ndarray(format='rgb24'))
            else:
                raise ValueError(f"Unsupported image format: {image_format}")
        return None