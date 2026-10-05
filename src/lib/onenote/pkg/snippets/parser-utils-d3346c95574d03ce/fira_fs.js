// Fira: in-memory stand-in for the Node `fs`/`path` calls the converter makes,
// so it runs in the browser (wasm-pack --target web). Upstream imports
// node_functions.js + node's fs/path; wasm_driver.rs points all three here.
//
// The host fills `globalThis.__firaOneNoteFs` before calling the converter:
//   inputs:  Map<path, Uint8Array>   — the .one file(s) to read
//   outputs: Map<path, Uint8Array>   — everything the converter writes
//   dirs:    Set<path>
// Paths are POSIX ('/'); isWindows() is false.

const vfs = () => {
	const v = globalThis.__firaOneNoteFs
	if (!v) throw new Error('Fira OneNote fs is not initialised')
	return v
}

const norm = (p) => {
	const abs = p.startsWith('/')
	const out = []
	for (const part of p.split('/')) {
		if (!part || part === '.') continue
		if (part === '..') out.pop()
		else out.push(part)
	}
	return (abs ? '/' : '') + out.join('/')
}

export function basename(p) {
	const n = norm(p)
	return n.slice(n.lastIndexOf('/') + 1)
}
export function extname(p) {
	const b = basename(p)
	const i = b.lastIndexOf('.')
	return i > 0 ? b.slice(i) : ''
}
export function dirname(p) {
	const n = norm(p)
	const i = n.lastIndexOf('/')
	if (i < 0) return '.'
	return i === 0 ? '/' : n.slice(0, i)
}
export function join(a, b) {
	return norm(`${a}/${b}`)
}
export function pathSep() {
	return '/'
}
export function removePrefix(basePath, prefix) {
	return basePath.replace(prefix, '')
}
export function getOutputPath(inputDir, outputDir, filePath) {
	return dirname(join(outputDir, removePrefix(filePath, inputDir)))
}
export function isWindows() {
	return false
}

export function mkdirSyncRecursive(p) {
	let cur = norm(p)
	while (cur && cur !== '/' && cur !== '.') {
		vfs().dirs.add(cur)
		cur = dirname(cur)
	}
}
export function existsSync(p) {
	const n = norm(p)
	const v = vfs()
	return v.inputs.has(n) || v.outputs.has(n) || v.dirs.has(n)
}
export function isDirectory(p) {
	return vfs().dirs.has(norm(p))
}
export function readDir(p) {
	const dir = norm(p)
	const v = vfs()
	const kids = new Set()
	for (const key of [...v.inputs.keys(), ...v.outputs.keys(), ...v.dirs]) {
		if (dirname(key) === dir) kids.add(key)
	}
	return [...kids].join('\n')
}
export function readFileSync(p) {
	const n = norm(p)
	const v = vfs()
	const data = v.inputs.get(n) ?? v.outputs.get(n)
	if (!data) throw new Error(`ENOENT: ${n}`)
	return data
}
export function normalizeAndWriteFile(p, data) {
	const n = norm(p)
	mkdirSyncRecursive(dirname(n))
	vfs().outputs.set(n, new Uint8Array(data))
}
export function normalizeAndAppendFile(p, data) {
	const n = norm(p)
	const v = vfs()
	const prev = v.outputs.get(n) ?? new Uint8Array(0)
	const next = new Uint8Array(prev.length + data.length)
	next.set(prev, 0)
	next.set(data, prev.length)
	v.outputs.set(n, next)
}
export function fileReader(p) {
	const data = readFileSync(p)
	return {
		// u64 arrives as BigInt
		read: (position, length) => {
			const start = Number(position)
			return data.subarray(start, Math.min(data.length, start + Number(length)))
		},
		size: () => BigInt(data.length),
		close: () => {},
	}
}
