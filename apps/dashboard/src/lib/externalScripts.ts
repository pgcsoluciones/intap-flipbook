const pendingScripts = new Map<string, Promise<void>>()

function loadExternalScript(id: string, src: string): Promise<void> {
  const existing = document.getElementById(id) as HTMLScriptElement | null

  if (existing?.dataset.loaded === 'true') {
    return Promise.resolve()
  }

  const pending = pendingScripts.get(id)
  if (pending) return pending

  const promise = new Promise<void>((resolve, reject) => {
    const script = existing ?? document.createElement('script')

    const handleLoad = () => {
      script.dataset.loaded = 'true'
      resolve()
    }

    const handleError = () => {
      pendingScripts.delete(id)
      script.remove()
      reject(new Error(`No se pudo cargar ${src}`))
    }

    script.addEventListener('load', handleLoad, { once: true })
    script.addEventListener('error', handleError, { once: true })

    if (!existing) {
      script.id = id
      script.src = src
      script.async = true
      document.head.appendChild(script)
    }
  })

  pendingScripts.set(id, promise)
  return promise
}

export async function ensurePdfJs(): Promise<any> {
  if ((window as any).pdfjsLib) return (window as any).pdfjsLib

  await loadExternalScript(
    'intap-pdf-js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  )

  const pdfjsLib = (window as any).pdfjsLib

  if (!pdfjsLib) {
    throw new Error('PDF.js no quedó disponible.')
  }

  return pdfjsLib
}
