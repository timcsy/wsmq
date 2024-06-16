import { WebSocketMQClient, bufferToHex } from './client.js'
import { ImageStream } from './image_stream.js'

let terminate = false

async function test_client() {
	const client = new WebSocketMQClient('ws://localhost:6789')
	client.connect()

	await new Promise(resolve => setTimeout(resolve, 1000))

	client.subscribe('test/topic', (topic, payload, props) => {
		console.log(`Receive ${topic}: ${payload}, length: ${payload.length}, props: ${JSON.stringify(props)}`)
	})
	client.subscribe('test/binary', (topic, payload, props) => {
		console.log(`Receive ${topic}: ${bufferToHex(payload)}, length: ${payload.length}, props: ${JSON.stringify(props)}`)
	})
	client.publish('test/topic', `Hello, MQTT! I'm ${client.id}`, 'text/plain')
	client.publish('test/binary', new Uint8Array([0x01, 0x02, 0x03, 0x04]), 'application/octet-stream')

	await new Promise(resolve => setTimeout(resolve, 20000))

	client.unsubscribe('test/topic')
	client.disconnect()
}

async function test_image_stream() {
  const stream = new ImageStream('ws://localhost:6789', 100)
  await stream.start()
  const topic = `${stream.client.id}/video/stream`

  // Create a single canvas element
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)

  stream.displayImage(topic, canvas)

  let width = 640
  let height = 480
  let metadata = {
    timestamp: Date.now(),
    width,
    height,
    frame_rate: 30,
    pix_fmt: 'yuv420p',
    gop_size: 10
  }
  stream.publish(topic, metadata)
  for (let i = 0; i < 50; i++) {
    const frame = new Uint8ClampedArray(width * height * 4).map(() => Math.random() * 255)
    const imageData = new ImageData(frame, width, height)
    stream.addImage(topic, imageData)
    await new Promise(resolve => setTimeout(resolve, 33))
  }
  
  width = 320
  height = 100
  metadata = { width, height }
  stream.publish(topic, metadata)
  while (!terminate) {
    const frame = new Uint8ClampedArray(width * height * 4).map(() => Math.random() * 255)
    const imageData = new ImageData(frame, width, height)
    stream.addImage(topic, imageData)
    await new Promise(resolve => setTimeout(resolve, 33))
  }

  await stream.stop()
  terminate = false
}

async function test_image_stream_pub() {
  const stream = new ImageStream('ws://localhost:6789', 100)
  await stream.start()
  const topic = `video/stream`

  let width = 640
  let height = 480
  let metadata = {
    timestamp: Date.now(),
    width,
    height,
    frame_rate: 30,
    pix_fmt: 'yuv420p',
    gop_size: 10
  }
  stream.publish(topic, metadata)
  for (let i = 0; i < 50; i++) {
    const frame = new Uint8ClampedArray(width * height * 4).map(() => Math.random() * 255)
    const imageData = new ImageData(frame, width, height)
    stream.addImage(topic, imageData)
    await new Promise(resolve => setTimeout(resolve, 33))
  }
  
  width = 320
  height = 100
  metadata = { width, height }
  stream.publish(topic, metadata)
  while (!terminate) {
    const frame = new Uint8ClampedArray(width * height * 4).map(() => Math.random() * 255)
    const imageData = new ImageData(frame, width, height)
    stream.addImage(topic, imageData)
    await new Promise(resolve => setTimeout(resolve, 33))
  }

  await stream.stop()
  terminate = false
}

async function test_image_stream_sub() {
  const stream = new ImageStream('ws://localhost:6789', 100)
  await stream.start()
  const topic = `video/stream`

  // Create a single canvas element
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)

  stream.displayImage(topic, canvas)

  while (!terminate) {
    await new Promise(resolve => setTimeout(resolve, 33))
  }

  await stream.stop()
  terminate = false
}

// test_client()
// test_image_stream()
// test_image_stream_pub()
// test_image_stream_sub()

document.getElementById('subpub_btn').addEventListener('click', () => {
  test_image_stream()
})

document.getElementById('sub_btn').addEventListener('click', () => {
  test_image_stream_sub()
})

document.getElementById('pub_btn').addEventListener('click', () => {
  test_image_stream_pub()
})

document.getElementById('terminate_btn').addEventListener('click', () => {
  terminate = true
})