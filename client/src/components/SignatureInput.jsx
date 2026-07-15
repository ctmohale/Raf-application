import { useEffect, useRef } from 'react';

export default function SignatureInput({ id, value, onChange }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const hasInkRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);

    if (!String(value || '').startsWith('data:image/')) {
      const textValue = String(value || '').trim();
      if (textValue) {
        context.font = '52px "Brush Script MT", "Segoe Script", "Lucida Handwriting", cursive';
        context.fillStyle = '#031426';
        context.fillText(textValue, 24, 112, canvas.width - 48);
        hasInkRef.current = true;
      }
      return;
    }

    const image = new Image();
    image.onload = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      hasInkRef.current = true;
    };
    image.src = value;
  }, [value]);

  function getPoint(event) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height
    };
  }

  function startDrawing(event) {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    const point = getPoint(event);
    drawingRef.current = true;
    hasInkRef.current = true;
    canvas.setPointerCapture(event.pointerId);
    context.beginPath();
    context.moveTo(point.x, point.y);
  }

  function draw(event) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    const point = getPoint(event);
    context.lineTo(point.x, point.y);
    context.strokeStyle = '#031426';
    context.lineWidth = 4;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.stroke();
  }

  function stopDrawing(event) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    drawingRef.current = false;
    if (event.pointerId && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    onChange(hasInkRef.current ? canvas.toDataURL('image/png') : '');
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    hasInkRef.current = false;
    onChange('');
  }

  return (
    <div className="claim-form-signature-pad">
      <canvas
        ref={canvasRef}
        width="720"
        height="180"
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={stopDrawing}
        onPointerCancel={stopDrawing}
        aria-label="Handwritten signature input"
      />
      <input tabIndex={-1} aria-hidden="true" className="signature-hidden-input" id={id} value={value || ''} onChange={() => {}} />
      <button type="button" onClick={clearSignature}>Clear</button>
    </div>
  );
}
