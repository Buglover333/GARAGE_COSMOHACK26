/** Create the procedural background used by the Three.js scene. */
export function createStarfieldCanvas(width = 2048, height = 1024): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.fillStyle = '#03060d';
  ctx.fillRect(0, 0, width, height);

  const nebula = ctx.createRadialGradient(
    width * 0.7,
    height * 0.3,
    50,
    width * 0.7,
    height * 0.3,
    400,
  );
  nebula.addColorStop(0, 'rgba(30, 58, 138, 0.15)');
  nebula.addColorStop(0.5, 'rgba(88, 28, 135, 0.08)');
  nebula.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = nebula;
  ctx.fillRect(0, 0, width, height);

  for (let index = 0; index < 1200; index++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const radius = Math.random() * 1.4;
    const brightness = 0.3 + Math.random() * 0.7;
    const colorType = Math.random();

    if (colorType > 0.8) {
      ctx.fillStyle = `rgba(186, 230, 253, ${brightness})`;
    } else if (colorType > 0.6) {
      ctx.fillStyle = `rgba(254, 240, 138, ${brightness})`;
    } else {
      ctx.fillStyle = `rgba(255, 255, 255, ${brightness})`;
    }

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas;
}
