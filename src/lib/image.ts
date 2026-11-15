/** Reduz a imagem (largura máxima) e converte para JPEG: leve, sem metadados (como a localização do celular) e compatível com todos os leitores. */
export async function prepareImage(file: File, maxWidth = 1200, maxBytes = 1_900_000): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxWidth / bmp.width)
  const c = document.createElement("canvas")
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale)
  const ctx = c.getContext("2d")!
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height)   // PNG com fundo transparente vira fundo branco
  ctx.drawImage(bmp, 0, 0, c.width, c.height)
  for (const q of [0.85, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", q))
    if (blob && blob.size <= maxBytes) return blob
  }
  throw new Error("A imagem ficou grande demais. Use uma menor.")
}
