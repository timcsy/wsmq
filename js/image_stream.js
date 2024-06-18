import { WebSocketMQClient } from './client.js'

class ImageStream {
  constructor(url = 'ws://localhost:6789', bufferSize = 1) {
    this.url = url
    this.bufferSize = bufferSize
    this.queues = {} // Queues for storing frames for different topics
    this.frames = {} // Current frames for different topics
    this.metadata = {} // Metadata for different topics
    this.subscribersReady = {} // Events for managing subscribers for different topics
    this.decoders = {} // Decoders for different topics
    this.encoders = {} // Encoders for different topics
    this.onReceives = {} // Key: topic, value: callback function (topic, image)
    this.client = new WebSocketMQClient(url)
    this.stopEvent = false
    this.frameCount = {} // Record the frame count for each topic
  }

  async onMessage(topic, payload, props) {
    const contentType = props['content_type'] || ''

    if (contentType === 'application/json') {
      const newMetadata = JSON.parse(payload)
      this.metadata[topic] = newMetadata
      this.subscribersReady[topic] = false
      await this.initializeDecoder(topic)
    } else if (contentType === 'video/encoded') {
      const isKeyframe = !!(new DataView(payload.buffer).getUint8(0))
      if (isKeyframe) {
        this.subscribersReady[topic] = true
      }
      if (this.subscribersReady[topic]) {
        const decoder = this.decoders[topic]
        try {
          const chunk = new EncodedVideoChunk({
            type: isKeyframe ? 'key' : 'delta',
            timestamp: 0,
            data: payload.slice(1)
          })
          const frame = await this.decodeChunk(decoder, chunk)
          this.frames[topic] = frame
          const onReceive = this.onReceives[topic] || null
          if (onReceive) {
            onReceive(topic, frame)
          }
          frame.close() // Ensure the frame is closed after use
        } catch (e) {
          console.error(`Error decoding packet: ${e}`)
        }
      }
    }
  }

  async decodeChunk(decoder, chunk) {
    return new Promise((resolve, reject) => {
      let frame
      decoder.decode(chunk, {
        complete: output => {
          frame = output
          resolve(frame)
        },
        error: reject
      })
    })
  }

  async initializeEncoder(topic, metadata) {
    const encoder = new VideoEncoder({
      output: chunk => this.encodeOutput(chunk, topic),
      error: e => console.error(`Encoder error: ${e}`)
    })
    const init = {
      codec: 'vp09.00.10.08',
      width: metadata.width || 640,
      height: metadata.height || 480,
      bitrate: 5000000,
      framerate: metadata.frame_rate || 30
    }
    await encoder.configure(init)
    this.encoders[topic] = encoder
    this.frameCount[topic] = 0 // Initialize frame count for the topic to 0
  }

  encodeOutput(chunk, topic) {
    const packet = new Uint8Array(chunk.byteLength + 1)
    packet[0] = chunk.type === 'key' ? 1 : 0
    chunk.copyTo(packet.subarray(1))
    this.client.publish(topic, packet, 'video/encoded')
  }

  async initializeDecoder(topic) {
    const decoder = new VideoDecoder({
      output: frame => {
        this.frames[topic] = frame
        const onReceive = this.onReceives[topic] || null
        if (onReceive) {
          onReceive(topic, frame)
        }
      },
      error: e => console.error(`Decoder error: ${e}`)
    })
    const codec = {
      codec: 'vp09.00.10.08'
    }
    await decoder.configure(codec)
    this.decoders[topic] = decoder
  }

  async encodeFrame(image, topic) {
    const metadata = this.metadata[topic]
    if (!metadata) {
      throw new Error(`No metadata available for topic ${topic}`)
    }

    if (!this.encoders[topic]) {
      await this.initializeEncoder(topic, metadata)
    }

    const encoder = this.encoders[topic]

    // Ensure image is an HTMLCanvasElement, HTMLVideoElement, or ImageBitmap
    let frame
    if (image instanceof HTMLCanvasElement || image instanceof HTMLVideoElement || image instanceof ImageBitmap) {
      frame = new VideoFrame(image, { timestamp: Date.now() })
    } else if (image instanceof ImageData) {
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const ctx = canvas.getContext('2d')
      ctx.putImageData(image, 0, 0)
      frame = new VideoFrame(canvas, { timestamp: Date.now() })
    } else {
      throw new Error('Unsupported image type.')
    }

    // Ensure the first frame of each topic is a keyframe and set keyframe according to gop_size
    const gopSize = metadata.gop_size || 50
    const isKeyframe = this.frameCount[topic] % gopSize === 0
    this.frameCount[topic] = (this.frameCount[topic] + 1) % gopSize // Increment frame count and mod by gopSize

    await encoder.encode(frame, { keyFrame: isKeyframe })
    frame.close() // Ensure the frame is closed after encoding
  }

  async sendFrame() {
    while (!this.stopEvent) {
      for (const topic in this.queues) {
        if (this.queues[topic].length > 0) {
          const image = this.queues[topic].shift()
          await this.encodeFrame(image, topic)
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1))
    }
  }

  async start() {
    this.client.connect()
    await new Promise(resolve => setTimeout(resolve, 500))
    this.thread = this.sendFrame()
  }

  async stop() {
    this.stopEvent = true
    await this.thread
    this.client.disconnect()
  }

  subscribe(topic, onReceive = null) {
    if (onReceive) {
      this.onReceives[topic] = onReceive
    }
    this.client.subscribe(topic, (t, p, props) => this.onMessage(t, p, props))
  }

  unsubscribe(topic) {
    delete this.onReceives[topic]
    this.client.unsubscribe(topic)
  }

  publish(topic, metadata) {
    this.metadata[topic] = metadata
    if (this.encoders[topic]) {
      delete this.encoders[topic] // Remove the encoder to ensure it gets re-initialized with new metadata
    }
    this.client.publish(topic, JSON.stringify(metadata), 'application/json')
  }

  addImage(topic, image) {
    if (!this.queues[topic]) {
      this.queues[topic] = []
    }

    if (this.queues[topic].length >= this.bufferSize) {
      this.queues[topic].shift() // Remove the oldest image to maintain buffer size
    }

    this.queues[topic].push(image)
  }

  getImage(topic) {
    return this.frames[topic]
  }

  displayImage(topic, canvas) {
    this.subscribe(topic, (topic, frame) => {
      // Update the canvas size if necessary
      if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
        canvas.width = frame.displayWidth
        canvas.height = frame.displayHeight
      }
      canvas.getContext('2d').drawImage(frame, 0, 0)
      frame.close() // Ensure the frame is closed after use
    })
  }
}

export { ImageStream }