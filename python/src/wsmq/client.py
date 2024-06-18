import logging
import struct
import threading
import time
import uuid
import websocket
import wsmq.config

class WebSocketMQClient:
    def __init__(self, url='ws://localhost:6789', id=None):
        self.url = url
        self.id = uuid.uuid4().hex if id is None else id
        self.ws = None
        self.ping_interval = 10
        self.on_receives = {}

    def connect(self, daemon=False):
        self.ws = websocket.WebSocketApp(
            self.url,
            on_open=self.on_open,
            on_message=self.on_message,
            on_error=self.on_error,
            on_close=self.on_close
        )
        threading.Thread(target=self.ws.run_forever, daemon=daemon).start()
    
    def on_open(self, ws):
        logging.info(f'Connected to MQTT Broker {self.url}, client id: {self.id}')
        self.send_connect()
        threading.Thread(target=self.send_ping, args=(self.ws,), daemon=True).start()
    
    def send_connect(self):
        protocol_name = 'MQTT'
        protocol_level = 4
        connect_flags = 2  # Clean session
        keep_alive = 60
        payload = struct.pack('!H', len(self.id)) + self.id.encode()
        connect_message = struct.pack('!BBH4sBBH', 0x10, 10 + len(self.id), len(protocol_name), protocol_name.encode(), protocol_level, connect_flags, keep_alive) + payload
        self._send(connect_message, websocket.ABNF.OPCODE_BINARY)

    def on_message(self, ws, message):
        data = bytearray(message)
        fixed_header = data[0]
        msg_type = fixed_header >> 4

        if msg_type == 2:  # CONNACK
            logging.debug('Received CONNACK')
        elif msg_type == 3:  # PUBLISH
            i = 1
            multiplier = 1
            remaining_length = 0
            while True:
                digit = data[i]
                i += 1
                remaining_length += (digit & 127) * multiplier
                multiplier *= 128
                if (digit & 128) == 0:
                    break
            
            topic_length = struct.unpack('!H', data[i:i+2])[0]
            i += 2
            topic = data[i:i+topic_length].decode()
            i += topic_length
            properties_length = data[i]
            i += 1
            props = {}
            while properties_length > 0:
                prop_id = data[i]
                i += 1
                properties_length -= 1
                if prop_id == 1:  # Payload Format Indicator
                    props['payload_format_indicator'] = data[i]
                    i += 1
                    properties_length -= 1
                elif prop_id == 3:  # Content Type
                    content_type_length = data[i]
                    i += 1
                    properties_length -= 1
                    props['content_type'] = data[i:i+content_type_length].decode()
                    i += content_type_length
                    properties_length -= content_type_length
            payload = data[i:]

            if 'payload_format_indicator' in props and props['payload_format_indicator'] == 1:
                payload = payload.decode() # not binary
            logging.debug(f'Received on topic {topic} with props: {props}, data: {payload}')
            if topic in self.on_receives:
                self.on_receives[topic](topic, payload, props)
        elif msg_type == 13:  # PINGRESP
            logging.debug('Received PINGRESP')

    def on_error(self, ws, error):
        logging.warning(f'Error: {error}')

    def on_close(self, ws, close_status_code, close_msg):
        logging.info('Connection closed')

    def subscribe(self, topic, on_receive, msg_id=1):
        self.on_receives[topic] = on_receive
        topic_length = len(topic)
        message = struct.pack('!BBH', 0x82, 5 + topic_length, msg_id) + struct.pack('!H', topic_length) + topic.encode() + b'\x00'
        self._send(message, websocket.ABNF.OPCODE_BINARY)
        logging.info(f'Subscribed to topic: {topic}')

    def unsubscribe(self, topic, msg_id=1):
        del self.on_receives[topic]
        topic_length = len(topic)
        message = struct.pack('!BBH', 0xA2, 4 + topic_length, msg_id) + struct.pack('!H', topic_length) + topic.encode()
        self._send(message, websocket.ABNF.OPCODE_BINARY)
        logging.info(f'Unsubscribed from topic: {topic}')
    
    def publish(self, topic, payload, content_type=None):
        topic_length = len(topic)
        if isinstance(payload, str):
            payload = payload.encode()
            is_binary = False
        else:
            is_binary = True
        payload_length = len(payload)
        fixed_header = 0x30  # PUBLISH
        properties = b''
        if is_binary:
            properties += struct.pack('!B', 1) + struct.pack('!B', 0)  # Payload Format Indicator
        else:
            properties += struct.pack('!B', 1) + struct.pack('!B', 1)  # Payload Format Indicator
        if content_type is not None:
            properties += struct.pack('!B', 3) + struct.pack('!B', len(content_type)) + content_type.encode()  # Content Type
        properties_length = len(properties)
        remaining_length = 2 + topic_length + 1 + properties_length + payload_length
        remaining_length_bytes = self.encode_remaining_length(remaining_length)
        message = struct.pack('!B', fixed_header) + remaining_length_bytes + struct.pack('!H', topic_length) + topic.encode() + struct.pack('!B', properties_length) + properties + payload
        self._send(message, websocket.ABNF.OPCODE_BINARY)
        logging.debug(f'Published message to topic {topic}, is_binary: {is_binary}, content_type: {content_type}')
    
    def encode_remaining_length(self, length):
        encoded = b''
        while True:
            digit = length % 128
            length = length // 128
            # if there are more digits to encode, set the top bit of this digit
            if length > 0:
                digit = digit | 0x80
            encoded += struct.pack('!B', digit)
            if length <= 0:
                break
        return encoded
    
    def send_ping(self, ws):
        while ws.keep_running:
            time.sleep(self.ping_interval)
            pingreq_message = struct.pack('!BB', 0xC0, 0x00)
            self._send(pingreq_message, websocket.ABNF.OPCODE_BINARY)
            logging.debug('Sent PINGREQ')
    
    def disconnect(self):
        disconnect_message = struct.pack('!BB', 0xE0, 0x00)
        self._send(disconnect_message, websocket.ABNF.OPCODE_BINARY)
        logging.debug('Sent DISCONNECT')
        self.ws.close()

    def _send(self, message, opcode):
        if self.ws and self.ws.sock and self.ws.sock.connected:
            self.ws.send(message, opcode=opcode)