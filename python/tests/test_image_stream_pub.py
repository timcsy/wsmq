import time
import numpy as np
from wsmq import ImageStream

if __name__ == '__main__':
    stream = ImageStream(url='ws://localhost:6789', buffer_size=100)
    stream.start()

    topic = 'video/stream'

    try:
        width, height = 640, 480
        metadata = {
            'timestamp': time.time(),
            'width': width,
            'height': height,
            'frame_rate': 30,
            'pix_fmt': 'yuv420p',
            'gop_size': 10
        }
        stream.publish(topic, metadata)
        for i in range(50):
            frame = np.random.randint(0, 256, (height, width, 3), dtype=np.uint8)  # Generate random image
            stream.add_image(topic, frame)
            time.sleep(1 / 30)  # Simulate 30 FPS
        
        width, height = 320, 100
        stream.publish(topic, metadata={ 'width': width, 'height': height })
        while True:
            frame = np.random.randint(0, 256, (height, width, 3), dtype=np.uint8)  # Generate random image
            stream.add_image(topic, frame)
            time.sleep(1 / 30)  # Simulate 30 FPS
    except KeyboardInterrupt:
        pass

    stream.stop()