const WebSocket = (typeof window !== 'undefined') ? window.WebSocket : require('ws')

// Function to generate a UUID
function generateUUID() {
  let d = new Date().getTime()
  if (typeof performance !== 'undefined' && typeof performance.now === 'function'){
    d += performance.now() // use high-precision timer if available
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (d + Math.random()*16)%16 | 0
    d = Math.floor(d/16)
    return (c === 'x' ? r : (r&0x3|0x8)).toString(16)
  })
}

function bufferToHex(buffer) {
  return "b'" + Array.prototype.map.call(new Uint8Array(buffer), x => '\\x' + ('00' + x.toString(16)).slice(-2)).join('') + "'"
}

// Function to convert a buffer to an ASCII string
function bufferToAscii(buffer) {
  return String.fromCharCode.apply(null, new Uint8Array(buffer))
}

class WebSocketMQClient {
  constructor(url = 'ws://localhost:6789', id = null) {
    this.url = url
    this.id = id || generateUUID().replace(/-/g, '')
    this.pingInterval = 10
    this.onReceives = {}
    this.ws = null
		this.pingIntervalId = null
  }

  connect(daemon = false) {
    this.ws = new WebSocket(this.url)

    this.ws.onopen = () => {
      console.log(`Connected to MQTT Broker ${this.url}, client id: ${this.id}`)
      this.sendConnect()
      this.pingIntervalId = setInterval(() => this.sendPing(), this.pingInterval * 1000)
    }

    this.ws.onmessage = (event) => {
      this.onMessage(event.data)
    }

    this.ws.onerror = (error) => {
      console.error(`Error: ${error.message}`)
    }

    this.ws.onclose = () => {
      console.log('Connection closed')
			clearInterval(this.pingIntervalId)
    }
  }

  sendConnect() {
    const protocolName = 'MQTT'
    const protocolLevel = 4
    const connectFlags = 2  // Clean session
    const keepAlive = 60
    const clientIdArray = new Uint8Array([this.id.length >> 8, this.id.length & 0xFF].concat(Array.from(this.id).map(c => c.charCodeAt(0))))
    const connectMessage = new Uint8Array([0x10, 10 + this.id.length, 0x00, protocolName.length, ...protocolName.split('').map(c => c.charCodeAt(0)), protocolLevel, connectFlags, keepAlive >> 8, keepAlive & 0xFF, ...clientIdArray])
    this.ws.send(connectMessage)
  }

  async onMessage(message) {
		if (message instanceof Blob) {
      message = await message.arrayBuffer()
    }

    // Ensure the message is a Uint8Array
    const data = new Uint8Array(message)
    const view = new DataView(data.buffer)
    const fixedHeader = view.getUint8(0)
    const msgType = fixedHeader >> 4

    if (msgType === 2) {  // CONNACK
      // console.log('Received CONNACK')
    } else if (msgType === 3) {  // PUBLISH
      let i = 1
      let multiplier = 1
      let remainingLength = 0
      let digit = 0
      do {
        digit = view.getUint8(i++)
        remainingLength += (digit & 127) * multiplier
        multiplier *= 128
      } while ((digit & 128) !== 0)

      const topicLength = view.getUint16(i)
      i += 2
      const topic = bufferToAscii(data.slice(i, i + topicLength))
      i += topicLength
      const propertiesLength = view.getUint8(i++)
      const props = {}
      let propIndex = i
      while (propIndex < i + propertiesLength) {
        const propId = view.getUint8(propIndex++)
        if (propId === 1) {  // Payload Format Indicator
          props['payload_format_indicator'] = view.getUint8(propIndex++)
        } else if (propId === 3) {  // Content Type
          const contentTypeLength = view.getUint8(propIndex++)
          props['content_type'] = bufferToAscii(data.slice(propIndex, propIndex + contentTypeLength))
          propIndex += contentTypeLength
        }
      }
      const payload = data.slice(i + propertiesLength)
      if (props['payload_format_indicator'] === 1) { // text
        // console.log(`Received on topic ${topic} with props: ${JSON.stringify(props)}, data: ${bufferToAscii(payload)}`)
        if (this.onReceives[topic]) {
          this.onReceives[topic](topic, bufferToAscii(payload), props)
        }
      } else { // binary
        // console.log(`Received on topic ${topic} with props: ${JSON.stringify(props)}, data: ${bufferToHex(payload)}`)
        if (this.onReceives[topic]) {
          this.onReceives[topic](topic, payload, props)
        }
      }
    } else if (msgType === 13) {  // PINGRESP
      // console.log('Received PINGRESP')
    }
  }

  subscribe(topic, onReceive, msgId = 1) {
    this.onReceives[topic] = onReceive
    const topicLength = topic.length
    const message = new Uint8Array([0x82, 5 + topicLength, msgId >> 8, msgId & 0xFF, topicLength >> 8, topicLength & 0xFF, ...topic.split('').map(c => c.charCodeAt(0)), 0x00])  // QoS
    this.ws.send(message)
    console.log(`Subscribed to topic: ${topic}`)
  }

  unsubscribe(topic, msgId = 1) {
    delete this.onReceives[topic]
    const topicLength = topic.length
    const message = new Uint8Array([0xA2, 4 + topicLength, msgId >> 8, msgId & 0xFF, topicLength >> 8, topicLength & 0xFF, ...topic.split('').map(c => c.charCodeAt(0))])
    this.ws.send(message)
    console.log(`Unsubscribed from topic: ${topic}`)
  }

  publish(topic, payload, contentType = null) {
    const topicLength = topic.length
    const payloadBuffer = (typeof payload === 'string') ? payload.split('').map(c => c.charCodeAt(0)) : payload
    const payloadLength = payloadBuffer.length
    let properties = [0x01, (typeof payload === 'string') ? 0x01 : 0x00]
    if (contentType) {
      properties = properties.concat([0x03, contentType.length, ...contentType.split('').map(c => c.charCodeAt(0))])
    }
    const propertiesLength = properties.length
    const remainingLength = 2 + topicLength + 1 + propertiesLength + payloadLength
    const remainingLengthBytes = this.encodeRemainingLength(remainingLength)
    const message = new Uint8Array([0x30, ...remainingLengthBytes, topicLength >> 8, topicLength & 0xFF, ...topic.split('').map(c => c.charCodeAt(0)), propertiesLength, ...properties, ...payloadBuffer])
    this.ws.send(message)
    // console.log(`Published message to topic ${topic}`)
  }

	encodeRemainingLength(length) {
    let encoded = []
    do {
      let digit = length % 128
      length = Math.floor(length / 128)
      // if there are more digits to encode, set the top bit of this digit
      if (length > 0) {
        digit = digit | 0x80
      }
      encoded.push(digit)
    } while (length > 0)
    return encoded
  }

  sendPing() {
    const pingreqMessage = new Uint8Array([0xC0, 0x00])
    this.ws.send(pingreqMessage)
    // console.log('Sent PINGREQ')
  }

  disconnect() {
    const disconnectMessage = new Uint8Array([0xE0, 0x00])
    this.ws.send(disconnectMessage)
    this.ws.close()
    // console.log('Sent DISCONNECT')
  }
}

export { WebSocketMQClient, bufferToHex }