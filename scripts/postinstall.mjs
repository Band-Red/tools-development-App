import { existsSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

/**
 * Some CI images and package managers run `npm install` with lifecycle scripts
 * disabled, which leaves the Electron binary missing. Re-download it when that
 * happens so `npm run dev` / `electron-builder` keep working everywhere.
 */
const electronDir = path.join(process.cwd(), 'node_modules', 'electron')
const binary = path.join(
  electronDir,
  'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron'
)

if (existsSync(electronDir) && !existsSync(binary)) {
  try {
    console.log('[tool-development] Fetching the Electron binary...')
    execFileSync(process.execPath, [path.join(electronDir, 'install.js')], { stdio: 'inherit' })
  } catch (error) {
    console.warn(
      '[tool-development] Could not download the Electron binary automatically:',
      error.message
    )
  }
}
