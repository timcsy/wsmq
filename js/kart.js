import { ImageStream } from './image_stream.js'

let terminate = false

function displayText(mq, topic, name) {
  const container = document.createElement('div')
  container.innerHTML = '<u><b>' + name + '</b></u><br>'
  const text = document.createElement('div')
  container.appendChild(text)
  document.body.appendChild(container)
  mq.subscribe(topic, (topic, payload, props) => {
    text.innerText = payload
  })
}

function displayImage(stream, topic, name) {
  const container = document.createElement('div')
  container.innerHTML = '<u><b>' + name + '</b></u><br>'
  const canvas = document.createElement('canvas')
  container.appendChild(canvas)
  document.body.appendChild(container)
  stream.displayImage(topic, canvas)
}

async function start() {
  const stream = new ImageStream('ws://localhost:6789', bufferSize = 1)
  const mq = stream.client
  await stream.start()

  displayImage(stream, "render", "render")
  displayText(mq, "action", "action")
  displayText(mq, 'observation/RaySensor', "observation['RaySensor']")
  displayImage(stream, "observation/CameraFront", "observation['CameraFront']")
  displayImage(stream, "cam/CameraFront", "cam['CameraFront']")
  displayImage(stream, "observation/CameraBack", "observation['CameraBack']")
  displayImage(stream, "cam/CameraBack", "cam['CameraBack']")
  displayText(mq, 'observation/Progress', "observation['Progress']")
  displayText(mq, 'observation/UsedTime', "observation['UsedTime']")
  displayText(mq, 'observation/Velocity', "observation['Velocity']")
  displayText(mq, 'observation/RefillRemaining', "observation['RefillRemaining']")
  displayText(mq, 'observation/EffectRemaining', "observation['EffectRemaining']")
  displayText(mq, 'reward', "reward")
  displayText(mq, 'terminated', "terminated")
  displayText(mq, 'truncated', "truncated")
  displayText(mq, 'info', "info")

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