/**
 * Audio file loading — WAV parser for Phase 1.
 * FLAC support, downsampling, and trimming added in Phase 2.
 */

/**
 * Parse a WAV file from an ArrayBuffer.
 * Handles 16-bit, 24-bit, 32-bit int and 32-bit float PCM.
 * Returns mono (left channel for stereo).
 *
 * @param {ArrayBuffer} buffer
 * @param {string} fileName
 * @returns {{ pcm: Float32Array, sampleRate: number, channels: number, duration: number, fileName: string }}
 */
export function parseWav(buffer, fileName) {
  const view = new DataView(buffer);

  // RIFF header
  const riff = String.fromCharCode(
    view.getUint8(0), view.getUint8(1),
    view.getUint8(2), view.getUint8(3),
  );
  if (riff !== 'RIFF') {
    throw new Error('Not a valid WAV file (missing RIFF header)');
  }

  const wave = String.fromCharCode(
    view.getUint8(8), view.getUint8(9),
    view.getUint8(10), view.getUint8(11),
  );
  if (wave !== 'WAVE') {
    throw new Error('Not a valid WAV file (missing WAVE format)');
  }

  // Find fmt and data chunks
  let offset = 12;
  let audioFormat = 0;
  let numChannels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset < buffer.byteLength - 8) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset), view.getUint8(offset + 1),
      view.getUint8(offset + 2), view.getUint8(offset + 3),
    );
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 'fmt ') {
      audioFormat = view.getUint16(offset + 8, true);
      numChannels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = chunkSize;
    }

    offset += 8 + chunkSize;
    if (chunkSize % 2 !== 0) offset += 1;
  }

  if (dataOffset === 0) {
    throw new Error('No data chunk found in WAV file');
  }

  if (audioFormat !== 1 && audioFormat !== 3) {
    throw new Error(
      `Unsupported WAV format (audioFormat=${audioFormat}). ` +
      'Only PCM and IEEE float are supported.',
    );
  }

  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = dataSize / bytesPerSample;
  const samplesPerChannel = totalSamples / numChannels;

  const pcm = new Float32Array(samplesPerChannel);

  for (let i = 0; i < samplesPerChannel; i++) {
    const bytePos = dataOffset + i * numChannels * bytesPerSample;

    if (audioFormat === 3 && bitsPerSample === 32) {
      pcm[i] = view.getFloat32(bytePos, true);
    } else if (bitsPerSample === 16) {
      pcm[i] = view.getInt16(bytePos, true) / 32768.0;
    } else if (bitsPerSample === 24) {
      const b0 = view.getUint8(bytePos);
      const b1 = view.getUint8(bytePos + 1);
      const b2 = view.getUint8(bytePos + 2);
      let val = (b2 << 16) | (b1 << 8) | b0;
      if (val & 0x800000) val |= ~0xFFFFFF;
      pcm[i] = val / 8388608.0;
    } else if (bitsPerSample === 32) {
      pcm[i] = view.getInt32(bytePos, true) / 2147483648.0;
    } else {
      throw new Error(`Unsupported bit depth: ${bitsPerSample}`);
    }
  }

  return {
    pcm,
    sampleRate,
    channels: numChannels,
    duration: samplesPerChannel / sampleRate,
    fileName,
  };
}

/**
 * Load a file from a File object (drag-drop or file picker).
 * @param {File} file
 * @returns {Promise<{ pcm: Float32Array, sampleRate: number, channels: number, duration: number, fileName: string }>}
 */
export function loadAudioFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buffer = e.target.result;
        const audio = parseWav(buffer, file.name);
        resolve(audio);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}
