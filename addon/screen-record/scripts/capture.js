const videoDemo = document.getElementById('video-demo')
const startRecordEle = document.getElementById('start-record')
const stopRecordEle = document.getElementById('stop-record')
const downloadEle = document.getElementById('download-video')
const dataRecord = []
var mediaRecorder

const CAPTURE_OPTIONS = {
    video: { cursor: 'always' },
    audio: {
        echoCancellation: false,
        noiseSuppression: false,
        sampleRate: 48000
    }
}

const MEDIA_RECORD_OPTIONS = {
    audioBitsPerSecond: 128_000,
    videoBitsPerSecond: 3_200_000,
    mimeType: 'video/webm'
}

startRecordOnPress = async () => {
    try {
        const captureStream = await navigator.mediaDevices.getDisplayMedia(CAPTURE_OPTIONS)
        loadMediaRecorder(captureStream)
        videoDemo.srcObject = captureStream
        captureStream.getVideoTracks()[0].addEventListener('ended', () => {
            stopRecordOnPress()
        })
    } catch (error) {console.log(error)}
    checkButton()
}

stopRecordOnPress = () => {
    stopRecord()
    mediaRecorder.stop()
    checkButton()
}

loadMediaRecorder = captureStream => {
    mediaRecorder = new MediaRecorder(captureStream, CAPTURE_OPTIONS)
    mediaRecorder.ondataavailable = e => dataRecord.push(e.data)
    mediaRecorder.onstop = () => {
        const blob = new Blob(dataRecord, { type: 'video/mp4' })
        const url = window.URL.createObjectURL(blob);
        downloadEle.href = url
        downloadEle.download = `vCapture-${new Date().getTime().toString(16)}.mp4`
        downloadEle.click()
        window.URL.revokeObjectURL(url)
    }
    mediaRecorder.start()
}

stopRecord = () => {
    const vdTracks = videoDemo.srcObject.getVideoTracks() || []
    const adTracks = videoDemo.srcObject.getAudioTracks()
    vdTracks.forEach(track => track.stop())
    adTracks.forEach(track => track.stop())
    videoDemo.srcObject = null;
    dataRecord.length = 0
}

checkButton = () => {
    if (mediaRecorder?.stream.active) {
        startRecordEle.style.display = 'none'
        stopRecordEle.style.display = 'block'
    } else {
        startRecordEle.style.display = 'block'
        stopRecordEle.style.display = 'none'
    }
}

checkButton()
