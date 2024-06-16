import { ImageStream } from './image_stream.js'

let terminate = false

async function test_image_stream_sub() {
  const stream = new ImageStream('ws://localhost:6789', 100)
  await stream.start()
  
  // Create a single canvas element
  const canvas_front = document.createElement('canvas')
  document.body.appendChild(canvas_front)
  const canvas_front_cam = document.createElement('canvas')
  document.body.appendChild(canvas_front_cam)
  const canvas_back = document.createElement('canvas')
  document.body.appendChild(canvas_back)
  const canvas_back_cam = document.createElement('canvas')
  document.body.appendChild(canvas_back_cam)

  stream.displayImage('video/front', canvas_front)
  stream.displayImage('video/front_cam', canvas_front_cam)
  stream.displayImage('video/back', canvas_back)
  stream.displayImage('video/back_cam', canvas_back_cam)

  while (!terminate) {
    await new Promise(resolve => setTimeout(resolve, 33))
  }

  await stream.stop()
  terminate = false
}

document.getElementById('sub_btn').addEventListener('click', () => {
  test_image_stream_sub()
})

document.getElementById('terminate_btn').addEventListener('click', () => {
  terminate = true
})