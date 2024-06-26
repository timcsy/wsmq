// Insert CSS styles
const styles = `
  .tensor-table td {
    padding: 5px;
    text-align: right;
  }

	.tensor-table td div {
		display: inline-block;
		width: 100%;
	}

  .tooltip {
    position: relative;
    display: inline-block;
  }
  .tooltip .tooltiptext {
    visibility: hidden;
    background-color: black;
    color: #fff;
    text-align: center;
    border-radius: 6px;
    padding: 5px;
    position: absolute;
    z-index: 1;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    max-width: 100vw;
    opacity: 0;
    transition: opacity 0.3s;
  }
  .tooltip:hover .tooltiptext {
    visibility: visible;
    opacity: 1;
  }
  .tooltip .tooltiptext::after {
    content: '';
    position: absolute;
    top: -5px;
    left: 50%;
    margin-left: -5px;
    border-width: 5px;
    border-style: solid;
    border-color: transparent transparent black transparent;
  }
`

const styleSheet = document.createElement("style")
styleSheet.type = "text/css"
styleSheet.innerText = styles
document.head.appendChild(styleSheet)

// Decode binary tensor data
function decodeTensor(data) {
	const buffer = data.buffer
  const headerSize = 4
  const view = new DataView(buffer)
  const ndim = view.getUint32(0, true)
  const shape = new Array(ndim).fill(0).map((_, i) => view.getUint32(headerSize + i * 4, true))
  const dtypeLength = view.getUint32(headerSize + ndim * 4, true)
  const dtype = new TextDecoder().decode(new Uint8Array(buffer, headerSize + ndim * 4 + 4, dtypeLength))
  const dataOffset = headerSize + ndim * 4 + 4 + dtypeLength
  const intensityFlagOffset = dataOffset + 1
  const intensityFlag = view.getUint8(dataOffset)
  const dataLength = shape.reduce((a, b) => a * b, 1)

  let dataTensor
  switch (dtype) {
    case 'float64':
      dataTensor = new Float64Array(buffer.slice(intensityFlagOffset, intensityFlagOffset + dataLength * 8))
      break
    case 'float32':
      dataTensor = new Float32Array(buffer.slice(intensityFlagOffset, intensityFlagOffset + dataLength * 4))
      break
    case 'int64':
      dataTensor = new BigInt64Array(buffer.slice(intensityFlagOffset, intensityFlagOffset + dataLength * 8))
      break
    case 'int32':
      dataTensor = new Int32Array(buffer.slice(intensityFlagOffset, intensityFlagOffset + dataLength * 4))
      break
    case 'int16':
      dataTensor = new Int16Array(buffer.slice(intensityFlagOffset, intensityFlagOffset + dataLength * 2))
      break
    case 'int8':
      dataTensor = new Int8Array(buffer.slice(intensityFlagOffset, intensityFlagOffset + dataLength))
      break
    case 'uint64':
      dataTensor = new BigUint64Array(buffer.slice(intensityFlagOffset, intensityFlagOffset + dataLength * 8))
      break
    case 'uint32':
      dataTensor = new Uint32Array(buffer.slice(intensityFlagOffset, intensityFlagOffset + dataLength * 4))
      break
    case 'uint16':
      dataTensor = new Uint16Array(buffer.slice(intensityFlagOffset, intensityFlagOffset + dataLength * 2))
      break
    case 'uint8':
      dataTensor = new Uint8Array(buffer.slice(intensityFlagOffset, intensityFlagOffset + dataLength))
      break
    default:
      console.error(`Unsupported dtype: ${dtype}`)
      return null
  }
  
  const heatmapTensor = intensityFlag ? new Uint8Array(buffer.slice(intensityFlagOffset + dataTensor.byteLength)) : null

  return { shape, dataTensor, heatmapTensor, dtype }
}

// Determine text color based on background brightness
function getTextColor(r, g, b) {
  const brightness = (0.299 * r + 0.587 * g + 0.114 * b)
  return brightness > 128 ? '#000000' : '#FFFFFF'
}

// Format value based on dtype
function formatValue(value, dtype) {
  if (dtype.startsWith('float')) {
    return value.toFixed(2) // Limit floating-point precision to 2 decimal places
  }
  return value.toString()
}

// Create HTML table to display tensor data
function createHtmlTable(dataTensor, heatmapTensor, shape, dtype) {
  let html = '<table class="tensor-table" style="width: 100%;">'

  if (shape.length === 0) {
    const content = formatValue(dataTensor[0], dtype)
    if (heatmapTensor) {
      const r = heatmapTensor[0]
      const g = heatmapTensor[1]
      const b = heatmapTensor[2]
      const color = `rgb(${r},${g},${b})`
      const textColor = getTextColor(r, g, b)
      html += `<tr><td style="background-color:${color}; color:${textColor}; display: inline-block; padding: 5px;"><div>${content}</div></td></tr>`
    } else {
      html += `<tr><td style="display: inline-block; padding: 5px;"><div>${content}</div></td></tr>`
    }
  } else if (shape.length === 1) {
    html += '<tr>'
    for (let i = 0; i < dataTensor.length; i++) {
      const content = formatValue(dataTensor[i], dtype)
      if (heatmapTensor) {
        const r = heatmapTensor[i * 3]
        const g = heatmapTensor[i * 3 + 1]
        const b = heatmapTensor[i * 3 + 2]
        const color = `rgb(${r},${g},${b})`
        const textColor = getTextColor(r, g, b)
        html += `<td style="background-color:${color}; color:${textColor}; width: 50px;" class="tooltip"><div>${content}</div><span class="tooltiptext">[${i}]</span></td>`
      } else {
        html += `<td style="width: 50px;" class="tooltip"><div>${content}</div><span class="tooltiptext">[${i}]</span></td>`
      }
    }
    html += '</tr>'
  } else if (shape.length === 2) {
    for (let i = 0; i < shape[0]; i++) {
      html += '<tr>'
      for (let j = 0; j < shape[1]; j++) {
        const index = i * shape[1] + j
        const content = formatValue(dataTensor[index], dtype)
        if (heatmapTensor) {
          const r = heatmapTensor[index * 3]
          const g = heatmapTensor[index * 3 + 1]
          const b = heatmapTensor[index * 3 + 2]
          const color = `rgb(${r},${g},${b})`
          const textColor = getTextColor(r, g, b)
          html += `<td style="background-color:${color}; color:${textColor}; width: 50px;" class="tooltip"><div>${content}</div><span class="tooltiptext">[${i},${j}]</span></td>`
        } else {
          html += `<td style="width: 50px;" class="tooltip"><div>${content}</div><span class="tooltiptext">[${i},${j}]</span></td>`
        }
      }
      html += '</tr>'
    }
  } else {
    // Handling higher dimensions by slicing and recursively generating tables
    for (let idx = 0; idx < shape[0]; idx++) {
      html += `<div style='font-weight: bold;'>Slice [${idx}, :, :]</div>`
      html += '<table class="tensor-table" style="width: 100%;">'
      for (let i = 0; i < shape[1]; i++) {
        html += '<tr>'
        for (let j = 0; j < shape[2]; j++) {
          const index = idx * shape[1] * shape[2] + i * shape[2] + j
          const content = formatValue(dataTensor[index], dtype)
          if (heatmapTensor) {
            const r = heatmapTensor[index * 3]
            const g = heatmapTensor[index * 3 + 1]
            const b = heatmapTensor[index * 3 + 2]
            const color = `rgb(${r},${g},${b})`
            const textColor = getTextColor(r, g, b)
            html += `<td style="background-color:${color}; color:${textColor}; width: 50px;" class="tooltip"><div>${content}</div><span class="tooltiptext">[${idx},${i},${j}]</span></td>`
          } else {
            html += `<td style="width: 50px;" class="tooltip"><div>${content}</div><span class="tooltiptext">[${idx},${i},${j}]</span></td>`
          }
        }
        html += '</tr>'
      }
      html += '</table>'
    }
  }
  html += '</table>'
  return html
}

// Function to display tensor
function tensorComponent(buffer) {
  const decodedTensor = decodeTensor(buffer)
  if (decodedTensor) {
    const { shape, dataTensor, heatmapTensor, dtype } = decodedTensor
    return createHtmlTable(dataTensor, heatmapTensor, shape, dtype)
  }
  return ''
}

export { tensorComponent }