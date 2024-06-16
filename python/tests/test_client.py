import threading
from wsmq import WebSocketMQClient

if __name__ == '__main__':
    client = WebSocketMQClient(url='ws://localhost:6789')
    client.connect()
    
    threading.Event().wait(1)
    
    client.subscribe(
        'test/topic',
        lambda topic, payload, props: print(f'Receive {topic}: {payload}, length: {len(payload)}, props: {props}')
    )
    client.subscribe(
        'test/binary',
        lambda topic, payload, props: print(f'Receive {topic}: {payload}, length: {len(payload)}, props: {props}')
    )
    client.publish('test/topic', f"Hello, MQTT! I'm {client.id}", content_type='text/plain')
    client.publish('test/binary', b'\x01\x02\x03\x04', content_type='application/octet-stream')
    threading.Event().wait(20)
    client.unsubscribe('test/topic')
    client.disconnect()