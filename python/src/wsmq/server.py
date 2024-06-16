import asyncio
import logging
import struct
import sys
import threading
from websockets.server import serve
from websockets.exceptions import ConnectionClosedOK, ConnectionClosedError
import wsmq.config

class WebSocketMQServer:
    def __init__(self, host='localhost', port=6789):
        self.host = host
        self.port = port
        self.clients = {}
        self.subscribers = {}

    def start(self, daemon=False):
        threading.Thread(target=self.run, daemon=daemon).start()
    
    def run(self):
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(self.run_server())

    async def run_server(self):
        async with serve(self.handle_client, self.host, self.port):
            logging.info(f'MQTT Server started on ws://{self.host}:{self.port}')
            await asyncio.Future()

    async def handle_client(self, websocket, path):
        client_id = None
        try:
            async for message in websocket:
                fixed_header_byte = message[0]
                msg_type = fixed_header_byte >> 4

                if msg_type == 1:  # CONNECT
                    client_id = await self.handle_connect(websocket, message)
                elif msg_type == 3:  # PUBLISH
                    await self.handle_publish(message)
                elif msg_type == 8:  # SUBSCRIBE
                    await self.handle_subscribe(websocket, message)
                elif msg_type == 10:  # UNSUBSCRIBE
                    await self.handle_unsubscribe(websocket, message)
                elif msg_type == 12:  # PINGREQ
                    await self.handle_pingreq(websocket)
                elif msg_type == 14:  # DISCONNECT
                    await self.handle_disconnect(client_id)
                    break
        except ConnectionClosedOK:
            if client_id:
                await self.handle_disconnect(client_id)
        except ConnectionClosedError:
            if client_id:
                await self.handle_disconnect(client_id)
        finally:
            if client_id:
                await self.handle_disconnect(client_id)
    
    async def handle_connect(self, websocket, message):
        protocol_name_length = struct.unpack('!H', message[2:4])[0]
        protocol_name = message[4:4+protocol_name_length].decode()
        protocol_level = message[4+protocol_name_length]
        connect_flags = message[5+protocol_name_length]
        keep_alive = struct.unpack('!H', message[6+protocol_name_length:8+protocol_name_length])[0]
        payload = message[8+protocol_name_length:]
        client_id_length = struct.unpack('!H', payload[0:2])[0]
        client_id = payload[2:2+client_id_length].decode()

        self.clients[client_id] = websocket

        connack_message = struct.pack('!BB', 0x20, 0x02) + struct.pack('!BB', 0x00, 0x00)
        await websocket.send(connack_message)
        logging.info(f'Client {client_id} connected')
        return client_id

    async def handle_disconnect(self, client_id):
        for topic, subscribers in self.subscribers.items():
            if client_id in self.clients and any(subscriber == self.clients[client_id] for subscriber in subscribers):
                self.subscribers[topic] = [subscriber for subscriber in subscribers if subscriber != self.clients[client_id]]
        if client_id in self.clients:
            del self.clients[client_id]
            logging.info(f'Client {client_id} disconnected')
    
    async def handle_subscribe(self, websocket, message):
        msg_id, = struct.unpack("!H", message[2:4])
        payload = message[4:]
        topics = self.parse_subscribe_topics(payload)
        for topic, qos in topics:
            if topic not in self.subscribers:
                self.subscribers[topic] = []
            self.subscribers[topic].append(websocket)
        await websocket.send(struct.pack('!BBH', 0x90, 3, msg_id) + b'\x00')

    async def handle_unsubscribe(self, websocket, message):
        msg_id, = struct.unpack('!H', message[2:4])
        payload = message[4:]
        topics = self.parse_unsubscribe_topics(payload)
        for topic in topics:
            if topic in self.subscribers and websocket in self.subscribers[topic]:
                self.subscribers[topic].remove(websocket)
                if not self.subscribers[topic]:
                    del self.subscribers[topic]
        await websocket.send(struct.pack('!BBH', 0xB0, 2, msg_id) + b'\x00')
    
    async def handle_publish(self, message):
        data = bytearray(message)

        index = 1
        multiplier = 1
        remaining_length = 0
        while True:
            digit = data[index]
            index += 1
            remaining_length += (digit & 127) * multiplier
            multiplier *= 128
            if (digit & 128) == 0:
                break
        
        topic_length = struct.unpack('!H', data[index:index+2])[0]
        index += 2
        topic = data[index:index+topic_length].decode()
        index += topic_length
        properties_length = data[index]
        index += 1
        props = {}
        while properties_length > 0:
            prop_id = data[index]
            index += 1
            properties_length -= 1
            if prop_id == 1:  # Payload Format Indicator
                props['payload_format_indicator'] = data[index]
                index += 1
                properties_length -= 1
            elif prop_id == 3:  # Content Type
                content_type_length = data[index]
                index += 1
                properties_length -= 1
                props['content_type'] = data[index:index+content_type_length].decode()
                index += content_type_length
                properties_length -= content_type_length
        payload = data[index:]

        if topic in self.subscribers:
            for subscriber in self.subscribers[topic]:
                await subscriber.send(message)
                logging.debug(f'Sent message to subscriber: {topic}, props: {props}')
    
    async def handle_pingreq(self, websocket):
        pingresp_message = struct.pack('!BB', 0xD0, 0x00)
        await websocket.send(pingresp_message)
        logging.debug('Sent PINGRESP')

    def parse_subscribe_topics(self, payload):
        topics = []
        i = 0
        while i < len(payload):
            topic_length = struct.unpack('!H', payload[i:i+2])[0]
            i += 2
            topic = payload[i:i+topic_length].decode()
            i += topic_length
            qos = payload[i]
            i += 1
            topics.append((topic, qos))
        return topics

    def parse_unsubscribe_topics(self, payload):
        topics = []
        i = 0
        while i < len(payload):
            topic_length = struct.unpack('!H', payload[i:i+2])[0]
            i += 2
            topic = payload[i:i+topic_length].decode()
            i += topic_length
            topics.append(topic)
        return topics

def run():
    port = 6789
    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    server = WebSocketMQServer(host='localhost', port=port)
    server.start()

def start():
    threading.Thread(target=run, daemon=True).start()

if __name__ == '__main__':
    run()