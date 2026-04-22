import { env, pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

env.allowLocalModels = false;

const loadModelBtn = document.querySelector('#loadModelBtn');
const startBtn = document.querySelector('#startBtn');
const stopBtn = document.querySelector('#stopBtn');
const modelSelect = document.querySelector('#modelSelect');
const statusEl = document.querySelector('#status');
const transcriptEl = document.querySelector('#transcript');

let transcriber = null;
let activeModelId = null;
const pipelineCache = new Map();
let mediaRecorder = null;
let recordedChunks = [];

function setStatus(message) {
  statusEl.textContent = message;
}

async function loadModel() {
  const modelId = modelSelect.value;

  loadModelBtn.disabled = true;
  modelSelect.disabled = true;
  startBtn.disabled = true;
  setStatus(`Loading model (${modelId})...`);

  try {
    if (pipelineCache.has(modelId)) {
      transcriber = pipelineCache.get(modelId);
      activeModelId = modelId;
      setStatus(`Model ready (${modelId}).`);
    } else {
      transcriber = await pipeline('automatic-speech-recognition', modelId, {
        progress_callback: (item) => {
          if (!item?.status) return;
          const percent = typeof item.progress === 'number' ? ` ${Math.round(item.progress)}%` : '';
          setStatus(`${item.status}${percent}`);
        }
      });
      pipelineCache.set(modelId, transcriber);
      activeModelId = modelId;
      setStatus(`Model loaded (${modelId}). Ready to record.`);
    }

    startBtn.disabled = false;
    loadModelBtn.disabled = false;
    modelSelect.disabled = false;
  } catch (error) {
    console.error(error);
    setStatus(`Model load failed: ${error.message}`);
    loadModelBtn.disabled = false;
    modelSelect.disabled = false;
  }
}

async function startRecording() {
  transcriptEl.value = '';
  recordedChunks = [];

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(recordedChunks, { type: 'audio/webm' });
      await transcribeBlob(audioBlob);
      stream.getTracks().forEach((track) => track.stop());
    };

    mediaRecorder.start();

    setStatus('Recording... Click "Stop + transcribe" when done.');
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } catch (error) {
    console.error(error);
    setStatus(`Could not start recording: ${error.message}`);
  }
}

async function transcribeBlob(blob) {
  if (!transcriber) return;

  setStatus('Decoding audio...');

  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioContext = new AudioContext({ sampleRate: 16000 });
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const audio = mergeToMono(audioBuffer);

    setStatus('Transcribing...');
    const result = await transcriber(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false
    });

    transcriptEl.value = result.text.trim() || '(No speech detected)';
    setStatus(`Done (${activeModelId ?? 'model'}).`);
    startBtn.disabled = false;
    stopBtn.disabled = true;
  } catch (error) {
    console.error(error);
    setStatus(`Transcription failed: ${error.message}`);
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

function mergeToMono(audioBuffer) {
  if (audioBuffer.numberOfChannels === 1) {
    return audioBuffer.getChannelData(0);
  }

  const length = audioBuffer.length;
  const mono = new Float32Array(length);

  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const data = audioBuffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      mono[i] += data[i] / audioBuffer.numberOfChannels;
    }
  }

  return mono;
}

loadModelBtn.addEventListener('click', loadModel);
startBtn.addEventListener('click', startRecording);
stopBtn.addEventListener('click', () => {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') return;

  stopBtn.disabled = true;
  setStatus('Stopping recording...');
  mediaRecorder.stop();
});
