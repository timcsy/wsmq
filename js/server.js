const WebSocket = require('ws')

// Function to convert a buffer to an ASCII string
function bufferToAscii(buffer) {
  return String.fromCharCode.apply(null, new Uint8Array(buffer))
}

class WebSocketMQServer {
  constructor(host = 'localhost', port = 6789) {
    this.host = host
    this.port = port
    this.clients = {}
    this.subscribers = {}
  }

  start() {
    this.wss = new WebSocket.Server({ port: this.port })
    this.wss.on('connection', (ws) => this.handleConnection(ws))
    console.log(`MQTT Server started on ws://${this.host}:${this.port}`)
  }

  handleConnection(ws) {
    let clientId = null

    ws.on('message', (message) => {
      const fixedHeaderByte = message[0]
      const msgType = fixedHeaderByte >> 4

      if (msgType === 1) {  // CONNECT
        clientId = this.handleConnect(ws, message)
      } else if (msgType === 3) {  // PUBLISH
        this.handlePublish(message)
      } else if (msgType === 8) {  // SUBSCRIBE
        this.handleSubscribe(ws, message)
      } else if (msgType === 10) {  // UNSUBSCRIBE
        this.handleUnsubscribe(ws, message)
      } else if (msgType === 12) {  // PINGREQ
        this.handlePingreq(ws)
      } else if (msgType === 14) {  // DISCONNECT
        ws.close()
      }
    })

    ws.on('close', () => {
      if (clientId) {
        this.handleDisconnect(clientId)
      }
    })
  }

  handleConnect(ws, message) {
    const protocolNameLength = message.readUInt16BE(2)
    const protocolName = message.slice(4, 4 + protocolNameLength).toString()
    const clientIdLength = message.readUInt16BE(8 + protocolNameLength)
    const clientId = message.slice(10 + protocolNameLength, 10 + protocolNameLength + clientIdLength).toString()

    this.clients[clientId] = ws

    const connackMessage = Buffer.from([0x20, 0x02, 0x00, 0x00])
    ws.send(connackMessage)
    console.log(`Client ${clientId} connected`)
    return clientId
  }

  handleDisconnect(clientId) {
    Object.keys(this.subscribers).forEach(topic => {
      this.subscribers[topic] = this.subscribers[topic].filter(subscriber => subscriber !== this.clients[clientId])
      if (this.subscribers[topic].length === 0) {
        delete this.subscribers[topic]
      }
    })
    delete this.clients[clientId]
    console.log(`Client ${clientId} disconnected`)
  }

  handleSubscribe(ws, message) {
    const msgId = message.readUInt16BE(2)
    const payload = message.slice(4)
    const topics = this.parseSubscribeTopics(payload)

    topics.forEach(([topic, qos]) => {
      if (!this.subscribers[topic]) {
        this.subscribers[topic] = []
      }
      this.subscribers[topic].push(ws)
    })

    const subackMessage = Buffer.concat([Buffer.from([0x90, 3]), Buffer.from(Uint16Array.from([msgId]).buffer), Buffer.from([0x00])])
    ws.send(subackMessage)
  }

  handleUnsubscribe(ws, message) {
    const msgId = message.readUInt16BE(2)
    const payload = message.slice(4)
    const topics = this.parseUnsubscribeTopics(payload)

    topics.forEach(topic => {
      if (this.subscribers[topic]) {
        this.subscribers[topic] = this.subscribers[topic].filter(subscriber => subscriber !== ws)
        if (this.subscribers[topic].length === 0) {
          delete this.subscribers[topic]
        }
      }
    })

    const unsubackMessage = Buffer.concat([Buffer.from([0xB0, 2]), Buffer.from(Uint16Array.from([msgId]).buffer)])
    ws.send(unsubackMessage)
  }

  handlePublish(message) {
		const data = new Uint8Array(message)
    const view = new DataView(data.buffer)

    let index = 1
		let multiplier = 1
		let remainingLength = 0
		let digit = 0
		do {
			digit = view.getUint8(index++)
			remainingLength += (digit & 127) * multiplier
			multiplier *= 128
		} while ((digit & 128) !== 0)

		const topicLength = view.getUint16(index)
		index += 2
		const topic = bufferToAscii(data.slice(index, index + topicLength))

    if (this.subscribers[topic]) {
      this.subscribers[topic].forEach(subscriber => {
        subscriber.send(message)
      })
      console.log(`Published message to topic: ${topic}`)
    }
  }

  handlePingreq(ws) {
    const pingrespMessage = Buffer.from([0xD0, 0x00])
    ws.send(pingrespMessage)
    console.log('Sent PINGRESP')
  }

  parseSubscribeTopics(payload) {
    const topics = []
    let i = 0

    while (i < payload.length) {
      const topicLength = payload.readUInt16BE(i)
      i += 2
      const topic = payload.slice(i, i + topicLength).toString()
      i += topicLength
      const qos = payload[i]
      i += 1
      topics.push([topic, qos])
    }

    return topics
  }

  parseUnsubscribeTopics(payload) {
    const topics = []
    let i = 0

    while (i < payload.length) {
      const topicLength = payload.readUInt16BE(i)
      i += 2
      const topic = payload.slice(i, i + topicLength).toString()
      i += topicLength
      topics.push(topic)
    }

    return topics
  }
}

const server = new WebSocketMQServer('localhost', 6789)
server.start()