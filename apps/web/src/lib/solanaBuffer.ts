import { Buffer } from 'buffer'

const root = globalThis as typeof globalThis & { Buffer?: typeof Buffer }
if (!root.Buffer) root.Buffer = Buffer
