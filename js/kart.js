import { ImageStream } from './image_stream.js'
import { tensorComponent } from './tensor.js'

let terminate = false

function displayText(mq, topic) {
  const container = document.createElement('div')
  container.innerHTML = '<u><b>' + topic + '</b></u><br>'
  const text = document.createElement('div')
  container.appendChild(text)
  mq.subscribe(topic, (topic, payload, props) => {
    text.innerText = payload
  })
  return container
}

function displayTensor(mq, topic) {
  const container = document.createElement('div')
  container.innerHTML = '<u><b>' + topic + '</b></u><br>'
  const tensor = document.createElement('div')
  container.appendChild(tensor)
  mq.subscribe(topic, (topic, payload, props) => {
    tensor.innerHTML = tensorComponent(payload)
  })
  return container
}

function displayImage(stream, topic) {
  const container = document.createElement('div')
  container.innerHTML = '<u><b>' + topic + '</b></u><br>'
  const canvas = document.createElement('canvas')
  container.appendChild(canvas)
  stream.displayImage(topic, canvas)
  return container
}

async function start() {
  const stream = new ImageStream('ws://localhost:6789', 1)
  const mq = stream.client
  await stream.start()

  document.body.appendChild(displayImage(stream, 'render'))
  document.body.appendChild(displayText(mq, 'action'))
  document.body.appendChild(displayTensor(mq, 'observation/RaySensor'))
  document.body.appendChild(displayImage(stream, 'observation/CameraFront'))
  document.body.appendChild(displayImage(stream, 'saliency/CameraFront'))
  document.body.appendChild(displayImage(stream, 'cam/CameraFront'))
  document.body.appendChild(displayImage(stream, 'observation/CameraBack'))
  document.body.appendChild(displayImage(stream, 'saliency/CameraBack'))
  document.body.appendChild(displayImage(stream, 'cam/CameraBack'))
  document.body.appendChild(displayTensor(mq, 'observation/Progress'))
  document.body.appendChild(displayTensor(mq, 'observation/UsedTime'))
  document.body.appendChild(displayTensor(mq, 'observation/Velocity'))
  document.body.appendChild(displayTensor(mq, 'observation/RefillRemaining'))
  document.body.appendChild(displayTensor(mq, 'observation/EffectRemaining'))
  document.body.appendChild(displayText(mq, 'reward'))
  document.body.appendChild(displayText(mq, 'terminated'))
  document.body.appendChild(displayText(mq, 'truncated'))
  document.body.appendChild(displayText(mq, 'info'))

  while (!terminate) {
    await new Promise(resolve => setTimeout(resolve, 33))
  }

  await stream.stop()
  terminate = false
}

document.getElementById('start_btn').addEventListener('click', () => {
  start()
})

document.getElementById('terminate_btn').addEventListener('click', () => {
  terminate = true
})