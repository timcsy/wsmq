import numpy as np
import cv2
import struct

def generate_heatmap(intensity_tensor):
    original_shape = intensity_tensor.shape
    if intensity_tensor.ndim == 0:
        intensity_tensor = np.array([[intensity_tensor]])
    elif intensity_tensor.ndim == 1:
        intensity_tensor = intensity_tensor.reshape(1, -1)
    elif intensity_tensor.ndim > 2:
        intensity_tensor = intensity_tensor.reshape(-1, intensity_tensor.shape[-1])
    
    # Ensure intensity_tensor is of type CV_8UC1
    intensity_tensor = np.uint8(255 * intensity_tensor)
    
    # Apply the color map
    heatmap = cv2.applyColorMap(intensity_tensor, cv2.COLORMAP_JET)
    heatmap_rgb = cv2.cvtColor(heatmap, cv2.COLOR_BGR2RGB)
    heatmap_rgb = heatmap_rgb.reshape(original_shape + (3,))
    return heatmap_rgb

def encode_tensor(data_tensor, intensity_tensor=None):
    if np.isscalar(data_tensor):
        data_tensor = np.array(data_tensor)
    if intensity_tensor is not None and np.isscalar(intensity_tensor):
        intensity_tensor = np.array(intensity_tensor)

    if intensity_tensor is not None and data_tensor.shape != intensity_tensor.shape:
        raise ValueError("Data tensor and intensity tensor must have the same shape.")
    
    data_shape = data_tensor.shape
    data_dtype = str(data_tensor.dtype)

    header = struct.pack('I', len(data_shape)) + struct.pack('I' * len(data_shape), *data_shape)
    dtype_header = struct.pack('I', len(data_dtype)) + data_dtype.encode('utf-8')
    data_bin = data_tensor.tobytes()

    if intensity_tensor is None:
        intensity_flag = struct.pack('?', False)
        return header + dtype_header + intensity_flag + data_bin
    else:
        intensity_flag = struct.pack('?', True)
        heatmap = generate_heatmap(intensity_tensor).reshape(-1, 3)
        heatmap_bin = heatmap.tobytes()
        return header + dtype_header + intensity_flag + data_bin + heatmap_bin

def encode_image(image_tensor, intensity_tensor=None, gray_scale=False, use_rgb=True, image_weight=0.5):
    # Dimension checks
    image_shape = image_tensor.shape[:-1] if not gray_scale else image_tensor.shape
    if intensity_tensor is not None:
        intensity_shape = intensity_tensor.shape
        if image_shape != intensity_shape:
            raise ValueError("Shape of image tensor and intensity tensor must match (excluding color channels).")

    def process_single_image(image, intensity=None):
        if gray_scale:
            image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
        if intensity is not None:
            heatmap = cv2.applyColorMap(np.uint8(255 * intensity), cv2.COLORMAP_JET)
            if not gray_scale and use_rgb:
                image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
            overlayed_image = cv2.addWeighted(image, image_weight, heatmap, 1 - image_weight, 0)
            if not gray_scale and use_rgb:
                overlayed_image = cv2.cvtColor(overlayed_image, cv2.COLOR_BGR2RGB)
            return overlayed_image
        return image

    def recursive_process(image_tensor, intensity_tensor=None):
        if (gray_scale and image_tensor.ndim == 2) or (not gray_scale and image_tensor.ndim == 3):
            # Process single image
            intensity = intensity_tensor if intensity_tensor is not None else None
            return process_single_image(image_tensor, intensity)
        elif (gray_scale and image_tensor.ndim > 2) or (not gray_scale and image_tensor.ndim > 3):
            # Process batch of images
            processed_images = [
                recursive_process(image_tensor[i], None if intensity_tensor is None else intensity_tensor[i])
                for i in range(image_tensor.shape[0])
            ]
            return np.array(processed_images)
        else:
            raise ValueError("Invalid dimensions for image tensor.")

    return recursive_process(image_tensor, intensity_tensor)