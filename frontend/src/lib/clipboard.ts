/**
 * Copy text to the clipboard, working even over plain HTTP.
 *
 * navigator.clipboard is only available in a secure context (HTTPS or
 * localhost). When the app is served over http://<ip> it is undefined, so we
 * fall back to a hidden <textarea> + document.execCommand('copy'), which works
 * in insecure contexts too. Returns true on success.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      /* fall through to the legacy method */
    }
  }

  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-9999px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
