import os
import time
from wsmq import ImageStream

if __name__ == '__main__':
    img_dir = 'imgs_peer'
    if not os.path.exists(img_dir):
        os.makedirs(img_dir)
    
    stream = ImageStream(url='ws://localhost:6789', buffer_size=100)
    stream.start()

    topic = 'video/stream'

    stream.subscribe(
        topic,
        image_format='PIL',
        on_receive=lambda topic, img: img.save(f'{img_dir}/{int(time.time()*1000)}.jpg')
    )

    try:
        while True:
            time.sleep(0.01)
    except KeyboardInterrupt:
        pass

    stream.stop()