import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import YAML from 'yaml'

const profileName = (process.env.LEON_PROFILE || 'just-me').trim() || 'just-me'
const leonHome = process.env.LEON_HOME?.trim()
  ? path.resolve(process.env.LEON_HOME.trim())
  : path.join(os.homedir(), '.leon')
const profileRoot = process.env.LEON_PROFILE_PATH?.trim()
  ? path.resolve(process.env.LEON_PROFILE_PATH.trim())
  : path.join(leonHome, 'profiles', profileName)
const configPath = path.join(profileRoot, 'config.yml')

if (!fs.existsSync(configPath)) {
  console.error(`Profilo JARVIS non trovato: ${configPath}`)
  console.error('Esegui prima il setup iniziale di JARVIS.')
  process.exit(1)
}

const source = fs.readFileSync(configPath, 'utf8')
const config = YAML.parse(source)

if (!config || typeof config !== 'object') {
  throw new Error('config.yml non contiene un oggetto YAML valido.')
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupPath = `${configPath}.backup-low-resource-${timestamp}`
fs.copyFileSync(configPath, backupPath)

config.routing ||= {}
config.routing.mode = 'smart'

config.llm ||= {}
config.llm.default = 'ollama/qwen3.5:4b'
config.llm.agent = 'ollama/qwen3.5:4b'

config.runtime ||= {}
config.runtime.agent_max_iterations = 64
config.runtime.pulse_enabled = false
config.runtime.private_diary_enabled = false
config.runtime.progressive_toolkit_loading = true

config.voice ||= {}
config.voice.wake_word_enabled = false
config.voice.asr ||= {}
config.voice.asr.enabled = false
config.voice.tts ||= {}
config.voice.tts.enabled = false

config.telemetry_enabled = false

fs.writeFileSync(configPath, YAML.stringify(config), 'utf8')

console.log('Profilo low-resource applicato.')
console.log(`Profilo: ${profileName}`)
console.log(`Config:  ${configPath}`)
console.log(`Backup:  ${backupPath}`)
console.log('Modello: ollama/qwen3.5:4b')
console.log('Agent iterations: 64')
console.log('Pulse/diary/voice background: off')
