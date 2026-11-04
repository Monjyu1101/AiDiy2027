// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

import type { AIWebSocket, WebSocketMessage } from '@/api/websocket'

type AudioControllerOptions = {
  onInputLevel?: (value: number) => void
  onOutputLevel?: (value: number) => void
  onInputSpectrum?: (values: number[]) => void
  onOutputSpectrum?: (values: number[]) => void
  getSocket: () => AIWebSocket | null
  getSessionId: () => string
}

type StartResult = { success: boolean; error?: string }
type CancelOutputOptions = {
  resetLevel?: boolean
  notifyServer?: boolean
}

const VISUALIZER_BAR_COUNT = 32

export class AudioController {
  private inputAudioContext: AudioContext | null = null
  private outputAudioContext: AudioContext | null = null
  private inputAnalyser: AnalyserNode | null = null
  private outputAnalyser: AnalyserNode | null = null
  private visualizerAnalyser: AnalyserNode | null = null
  private outputGain: GainNode | null = null
  private inputProcessor: ScriptProcessorNode | null = null
  private inputStream: MediaStream | null = null
  private audioSocket: AIWebSocket | null = null
  private sessionId = ''
  private speakerEnabled = true
  private inputLevelFrame = 0
  private outputLevelFrame = 0
  private speakerSources = new Set<AudioBufferSourceNode>()
  private visualizerSources = new Set<AudioBufferSourceNode>()
  private outputQueue: Array<{ base64Audio: string; mimeType: string }> = []
  private outputQueueProcessing = false
  private outputQueueGeneration = 0
  private inputSampleRate = 16000
  private outputSampleRate = 24000
  private nextPlaybackTime = 0
  private currentSpeakerLevel = 0        // スピーカー出力の現在レベル（0〜1）、エコー抑制に使用
  private suppressionBuffer: Float32Array | null = null  // エコー抑制用バッファ（事前確保）
  private fadeOutTimer: ReturnType<typeof setTimeout> | null = null  // フェードアウトタイマーID（競合防止）

  // フェードアウト・エコー抑制パラメータ
  private static readonly FADE_OUT_DURATION = 0.1           // キャンセル時フェードアウト秒数（人間の割り込みを最優先）
  private static readonly ECHO_SUPPRESSION_GAIN = 1.5       // 抑制係数（1.0=等倍、大きいほど強く抑制）
  private static readonly ECHO_SUPPRESSION_THRESHOLD = 0.01 // この値未満のスピーカーレベルは処理をスキップ

  constructor(private readonly options: AudioControllerOptions) {}

  setAudioSocket(socket: AIWebSocket | null): void {
    this.audioSocket = socket
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId
  }

  setLiveModelName(modelName: string): void {
    const normalized = modelName.toLowerCase()
    this.inputSampleRate = normalized.includes('openai') ? 24000 : 16000
    this.outputSampleRate = 24000

    const outputContext = this.outputAudioContext
    if (outputContext && outputContext.sampleRate !== this.outputSampleRate) {
      this.cancelOutput()
      void outputContext.close()
      this.outputAudioContext = null
      this.outputAnalyser = null
      this.visualizerAnalyser = null
      this.outputGain = null
      this.nextPlaybackTime = 0
    }
  }

  setSpeakerEnabled(enabled: boolean): void {
    this.speakerEnabled = enabled
    if (this.outputGain) {
      this.outputGain.gain.value = enabled ? 1 : 0
    }
    if (!enabled) {
      this.stopSpeakerSources()
      this.currentSpeakerLevel = 0  // スピーカーOFF時はエコー抑制レベルをリセット
    }
  }

  async unlockAudio(): Promise<void> {
    const context = this.ensureOutputContext()
    if (context.state === 'suspended') {
      await context.resume()
    }
  }

  async startMicrophone(): Promise<StartResult> {
    const socket = this.options.getSocket()
    if (!socket?.isConnected()) {
      return { success: false, error: 'サーバーに接続されていません。' }
    }

    try {
      await this.unlockAudio()
      await this.stopMicrophoneInternal()
      this.cancelOutput({ resetLevel: false, notifyServer: true })

      this.inputStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.inputSampleRate,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      this.inputAudioContext = new AudioContext({ sampleRate: this.inputSampleRate })
      const source = this.inputAudioContext.createMediaStreamSource(this.inputStream)
      this.inputAnalyser = this.inputAudioContext.createAnalyser()
      this.inputAnalyser.fftSize = 256
      source.connect(this.inputAnalyser)

      this.inputProcessor = this.inputAudioContext.createScriptProcessor(1024, 1, 1)
      this.suppressionBuffer = new Float32Array(1024)  // ScriptProcessorのバッファサイズに合わせて事前確保
      source.connect(this.inputProcessor)
      this.inputProcessor.connect(this.inputAudioContext.destination)
      this.inputProcessor.onaudioprocess = (event) => {
        const activeSocket = this.options.getSocket()
        if (!activeSocket?.isConnected()) return

        const inputData = this.applyEchoSuppression(event.inputBuffer.getChannelData(0))
        const pcm = this.floatTo16BitPCM(inputData)
        const pcmBuffer = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer
        activeSocket.send({
          セッションID: this.sessionId || this.options.getSessionId(),
          チャンネル: 'audio',
          メッセージ識別: 'input_audio',
          メッセージ内容: 'audio/pcm',
          ファイル名: this.arrayBufferToBase64(pcmBuffer),
          サムネイル画像: null,
        })
      }

      this.startInputLevelLoop()
      return { success: true }
    } catch (error) {
      await this.stopMicrophoneInternal()
      return {
        success: false,
        error: error instanceof Error ? error.message : 'マイクアクセスに失敗しました。',
      }
    }
  }

  stopMicrophone(): void {
    void this.stopMicrophoneInternal()
  }

  handleAudioMessage(message: WebSocketMessage): void {
    const base64Audio = this.extractBase64Audio(message)
    if (!base64Audio) return

    this.outputQueue.push({
      base64Audio,
      mimeType: String(message.メッセージ内容 || 'audio/pcm'),
    })
    if (!this.outputQueueProcessing) {
      void this.processOutputQueue()
    }
  }

  cancelOutput(options: CancelOutputOptions = {}): void {
    const { resetLevel = true, notifyServer = false } = options
    this.outputQueueGeneration += 1
    this.outputQueue = []
    this.outputQueueProcessing = false
    this.nextPlaybackTime = this.outputAudioContext?.currentTime ?? 0

    // 0.1秒フェードアウト後にソースを停止（人間の割り込みを妨げない最短フェード）
    // ※フェード中もエコー抑制（currentSpeakerLevel）を維持し、AI音声をマイクが拾わないようにする
    const context = this.outputAudioContext
    const gain = this.outputGain
    if (context && gain && this.speakerSources.size > 0) {
      const now = context.currentTime
      const fadeDuration = AudioController.FADE_OUT_DURATION
      gain.gain.cancelScheduledValues(now)
      gain.gain.setValueAtTime(gain.gain.value, now)
      gain.gain.linearRampToValueAtTime(0, now + fadeDuration)

      const sourcesToStop = [...this.speakerSources]  // Setコピー不要・スプレッドで十分
      this.speakerSources.clear()
      this.stopVisualizerSources()

      // 旧タイマーをキャンセルして競合防止（0.1秒以内の連続キャンセル時にゲインが誤復元されないよう）
      if (this.fadeOutTimer !== null) clearTimeout(this.fadeOutTimer)
      this.fadeOutTimer = setTimeout(() => {
        this.fadeOutTimer = null
        for (const source of sourcesToStop) {
          try { source.stop() } catch { /* 既に停止済み */ }
        }
        // フェード完了後にエコー抑制レベルをリセット（フェード中は抑制を維持）
        this.currentSpeakerLevel = 0
        // フェード後にゲインを元に戻す
        if (this.outputGain && this.outputAudioContext) {
          const t = this.outputAudioContext.currentTime
          const targetGain = this.speakerEnabled ? 1 : 0
          this.outputGain.gain.cancelScheduledValues(t)
          this.outputGain.gain.setValueAtTime(targetGain, t)
        }
      }, (AudioController.FADE_OUT_DURATION * 1000) + 20)
    } else {
      // ソースなし：即時停止＋即時リセット
      this.currentSpeakerLevel = 0
      this.stopSpeakerSources()
      this.stopVisualizerSources()
    }

    if (notifyServer) {
      this.notifyCancelAudio()
    }

    if (resetLevel) {
      this.options.onOutputLevel?.(0)
      this.options.onOutputSpectrum?.(this.emptySpectrum())
    }
  }

  cleanup(): void {
    this.cancelOutput()
    void this.stopMicrophoneInternal()
    if (this.outputLevelFrame) {
      window.cancelAnimationFrame(this.outputLevelFrame)
      this.outputLevelFrame = 0
    }
    if (this.outputAudioContext) {
      void this.outputAudioContext.close()
      this.outputAudioContext = null
      this.outputAnalyser = null
      this.visualizerAnalyser = null
      this.outputGain = null
    }
  }

  private async processOutputQueue(): Promise<void> {
    if (this.outputQueueProcessing) return
    this.outputQueueProcessing = true
    const queueGeneration = this.outputQueueGeneration
    try {
      while (this.outputQueue.length > 0) {
        if (queueGeneration !== this.outputQueueGeneration) {
          break
        }
        const nextAudio = this.outputQueue.shift()
        if (!nextAudio) {
          continue
        }
        const audioBuffer = await this.decodeAudioBuffer(nextAudio.base64Audio, nextAudio.mimeType)
        if (queueGeneration !== this.outputQueueGeneration) {
          break
        }
        this.scheduleAudioBuffer(audioBuffer)
      }
    } finally {
      if (queueGeneration === this.outputQueueGeneration) {
        this.outputQueueProcessing = false
      }
    }
  }

  private async decodeAudioBuffer(base64Audio: string, mimeType: string): Promise<AudioBuffer> {
    const context = this.ensureOutputContext()
    if (context.state === 'suspended') {
      await context.resume()
    }

    if (mimeType.toLowerCase().includes('audio/pcm')) {
      return this.createPcmAudioBuffer(context, base64Audio)
    }

    try {
      return await context.decodeAudioData(this.base64ToArrayBuffer(base64Audio))
    } catch {
      return this.createPcmAudioBuffer(context, base64Audio)
    }
  }

  private scheduleAudioBuffer(audioBuffer: AudioBuffer): void {
    const context = this.ensureOutputContext()
    const leadTime = 0.03
    const now = context.currentTime
    if (this.nextPlaybackTime < now - 0.1) {
      this.nextPlaybackTime = now
    }
    const startAt = Math.max(now + leadTime, this.nextPlaybackTime)
    this.nextPlaybackTime = startAt + audioBuffer.duration

    // チャンクの平均振幅をリップシンク用レベルとして再生開始タイミングで通知
    const channelData = audioBuffer.getChannelData(0)
    let sumAbs = 0
    for (let i = 0; i < channelData.length; i++) {
      sumAbs += Math.abs(channelData[i] ?? 0)
    }
    const chunkLevel = Math.min(1, (sumAbs / channelData.length) * 6)
    const playDelay = Math.max(0, (startAt - context.currentTime) * 1000)
    setTimeout(() => { this.options.onOutputLevel?.(chunkLevel) }, playDelay)

    const visualizerSource = context.createBufferSource()
    visualizerSource.buffer = audioBuffer
    visualizerSource.connect(this.visualizerAnalyser ?? context.destination)
    visualizerSource.onended = () => {
      this.visualizerSources.delete(visualizerSource)
      if (this.visualizerSources.size === 0 && this.speakerSources.size === 0) {
        this.nextPlaybackTime = 0
        this.options.onOutputLevel?.(0)
      }
    }
    this.visualizerSources.add(visualizerSource)
    visualizerSource.start(startAt)

    if (this.speakerEnabled) {
      const speakerSource = context.createBufferSource()
      speakerSource.buffer = audioBuffer
      speakerSource.connect(this.outputAnalyser ?? context.destination)
      speakerSource.onended = () => {
        this.speakerSources.delete(speakerSource)
        if (this.visualizerSources.size === 0 && this.speakerSources.size === 0) {
          this.nextPlaybackTime = 0
        }
      }
      this.speakerSources.add(speakerSource)
      speakerSource.start(startAt)
    }

    this.startOutputLevelLoop()
  }

  private ensureOutputContext(): AudioContext {
    if (!this.outputAudioContext) {
      this.outputAudioContext = new AudioContext({ sampleRate: this.outputSampleRate })
      this.outputAnalyser = this.outputAudioContext.createAnalyser()
      this.outputAnalyser.fftSize = 256
      this.visualizerAnalyser = this.outputAudioContext.createAnalyser()
      this.visualizerAnalyser.fftSize = 256
      this.outputGain = this.outputAudioContext.createGain()
      this.outputGain.gain.value = this.speakerEnabled ? 1 : 0
      this.outputAnalyser.connect(this.outputGain)
      this.outputGain.connect(this.outputAudioContext.destination)
    }
    return this.outputAudioContext
  }

  private startInputLevelLoop(): void {
    if (!this.inputAnalyser) return
    const data = new Uint8Array(this.inputAnalyser.frequencyBinCount)
    const tick = () => {
      if (!this.inputAnalyser) {
        this.options.onInputLevel?.(0)
        this.options.onInputSpectrum?.(this.emptySpectrum())
        this.inputLevelFrame = 0
        return
      }
      this.inputAnalyser.getByteFrequencyData(data)
      this.options.onInputLevel?.(this.computeLevel(data))
      this.options.onInputSpectrum?.(this.buildSpectrum(data))
      this.inputLevelFrame = window.requestAnimationFrame(tick)
    }
    if (!this.inputLevelFrame) {
      tick()
    }
  }

  private startOutputLevelLoop(): void {
    const speakerData = new Uint8Array((this.outputAnalyser?.frequencyBinCount ?? 0) || 0)
    const visualizerData = new Uint8Array((this.visualizerAnalyser?.frequencyBinCount ?? 0) || 0)
    const tick = () => {
      const analyser = this.speakerSources.size > 0 ? this.outputAnalyser : this.visualizerAnalyser
      const data = this.speakerSources.size > 0 ? speakerData : visualizerData

      if (!analyser || data.length === 0) {
        this.currentSpeakerLevel = 0  // analyser未初期化時はエコー抑制レベルをリセット
        this.options.onOutputSpectrum?.(this.emptySpectrum())
        this.outputLevelFrame = 0
        return
      }

      analyser.getByteFrequencyData(data)
      this.updateSpeakerLevel(this.computeLevel(data))
      this.options.onOutputSpectrum?.(this.buildSpectrum(data))

      if (this.speakerSources.size > 0 || this.visualizerSources.size > 0) {
        this.outputLevelFrame = window.requestAnimationFrame(tick)
      } else {
        this.currentSpeakerLevel = 0
        this.options.onOutputSpectrum?.(this.emptySpectrum())
        this.outputLevelFrame = 0
      }
    }

    if (!this.outputLevelFrame) {
      tick()
    }
  }

  private stopSpeakerSources(): void {
    this.speakerSources.forEach((source) => {
      try {
        source.stop()
      } catch {
        return
      }
    })
    this.speakerSources.clear()
  }

  private stopVisualizerSources(): void {
    this.visualizerSources.forEach((source) => {
      try {
        source.stop()
      } catch {
        return
      }
    })
    this.visualizerSources.clear()
  }

  private notifyCancelAudio(): void {
    const socket = this.options.getSocket()
    if (!socket?.isConnected()) return

    socket.send({
      セッションID: this.sessionId || this.options.getSessionId(),
      チャンネル: 'audio',
      メッセージ識別: 'cancel_audio',
      メッセージ内容: null,
      ファイル名: null,
      サムネイル画像: null,
    })
  }

  private computeLevel(data: Uint8Array): number {
    if (data.length === 0) return 0
    const sum = data.reduce((acc, value) => acc + value, 0)
    return Math.min(1, sum / data.length / 128)
  }

  private buildSpectrum(data: Uint8Array): number[] {
    if (data.length === 0) {
      return this.emptySpectrum()
    }

    const bucketSize = Math.max(1, Math.floor(data.length / VISUALIZER_BAR_COUNT))
    const values = Array.from({ length: VISUALIZER_BAR_COUNT }, (_, index) => {
      const start = index * bucketSize
      const end = Math.min(data.length, start + bucketSize)
      if (start >= data.length) {
        return 0.05
      }

      let sum = 0
      let count = 0
      for (let cursor = start; cursor < end; cursor += 1) {
        sum += data[cursor] ?? 0
        count += 1
      }
      const normalized = count > 0 ? sum / count / 255 : 0
      return Math.max(0.05, Math.min(1, normalized))
    })

    return values
  }

  private emptySpectrum(): number[] {
    return Array.from({ length: VISUALIZER_BAR_COUNT }, () => 0.05)
  }

  private floatTo16BitPCM(input: Float32Array): Int16Array {
    const output = new Int16Array(input.length)
    for (let index = 0; index < input.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, input[index] ?? 0))
      output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
    }
    return output
  }

  private createPcmAudioBuffer(context: AudioContext, base64Audio: string): AudioBuffer {
    const pcmBytes = this.base64ToArrayBuffer(base64Audio)
    const int16 = new Int16Array(pcmBytes)
    const audioBuffer = context.createBuffer(1, int16.length, this.outputSampleRate)
    const channelData = audioBuffer.getChannelData(0)
    for (let index = 0; index < int16.length; index += 1) {
      channelData[index] = (int16[index] ?? 0) / 0x8000
    }
    return audioBuffer
  }

  private extractBase64Audio(message: WebSocketMessage): string {
    const raw = message.ファイル名 || message.base64_data || message.audio || message.data
    return typeof raw === 'string' ? raw : ''
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = ''
    const bytes = new Uint8Array(buffer)
    for (let index = 0; index < bytes.byteLength; index += 1) {
      binary += String.fromCharCode(bytes[index] ?? 0)
    }
    return window.btoa(binary)
  }

  // スピーカー出力レベル分をマイク入力振幅から差し引くエコー抑制処理
  // マイクのハードウェアレベルは変えず、数値的に振幅を削減する
  private applyEchoSuppression(rawInput: Float32Array): Float32Array {
    const speakerLevel = this.currentSpeakerLevel
    if (speakerLevel <= AudioController.ECHO_SUPPRESSION_THRESHOLD) {
      return rawInput
    }
    const suppression = speakerLevel * AudioController.ECHO_SUPPRESSION_GAIN
    const buffer = this.suppressionBuffer ?? new Float32Array(rawInput.length)
    for (let i = 0; i < rawInput.length; i++) {
      const sample = rawInput[i] ?? 0
      const sign = sample >= 0 ? 1 : -1
      buffer[i] = sign * Math.max(0, Math.abs(sample) - suppression)
    }
    return buffer
  }

  // スピーカーレベルを即時更新（人の声割り込みを最優先）
  private updateSpeakerLevel(newLevel: number): void {
    this.currentSpeakerLevel = newLevel
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = window.atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes.buffer
  }

  private async stopMicrophoneInternal(): Promise<void> {
    if (this.inputLevelFrame) {
      window.cancelAnimationFrame(this.inputLevelFrame)
      this.inputLevelFrame = 0
    }
    this.options.onInputLevel?.(0)
    this.options.onInputSpectrum?.(this.emptySpectrum())

    if (this.inputProcessor) {
      this.inputProcessor.disconnect()
      this.inputProcessor.onaudioprocess = null
      this.inputProcessor = null
    }

    this.suppressionBuffer = null
    this.inputStream?.getTracks().forEach((track) => track.stop())
    this.inputStream = null
    this.inputAnalyser = null

    if (this.inputAudioContext) {
      await this.inputAudioContext.close()
      this.inputAudioContext = null
    }
  }
}
