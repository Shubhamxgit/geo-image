import React, { useEffect, useRef, useState } from "react";

/*
  Geo Image Stamp - Hybrid Google + OSM
  - Set VITE_GOOGLE_MAPS_KEY in .env to use Google Maps (better landmark data & map) 
  - Otherwise falls back to OSM (free)
*/

// Read Google key (Vite env)
const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || "";

const pad = (n) => String(n).padStart(2, "0");
function formatOffset(tzMinutes) {
  const total = -tzMinutes;
  const sign = total >= 0 ? "+" : "-";
  const abs = Math.abs(total);
  const hh = pad(Math.floor(abs / 60));
  const mm = pad(abs % 60);
  return `${sign}${hh}:${mm}`;
}
function to12HourWithSeconds(date) {
  let h = date.getHours();
  const m = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${pad(h)}:${m}:${s} ${ampm}`;
}

// Extract best landmark from Nominatim response
function extractNominatimLandmark(nom) {
  if (!nom) return "";
  if (nom.name) return nom.name;
  if (nom.display_name) {
    const first = nom.display_name.split(",")[0];
    if (first && first.length < 40) return first;
  }
  const a = nom.address || {};
  return (
    a.attraction ||
    a.building ||
    a.leisure ||
    a.amenity ||
    a.poi ||
    a.town ||
    a.village ||
    a.city ||
    a.suburb ||
    a.neighbourhood ||
    a.road ||
    ""
  );
}

// Extract good landmark from Google Geocoding results
function extractGoogleLandmark(geo) {
  if (!geo || !geo.results) return "";
  for (const r of geo.results) {
    if (r.types && (r.types.includes("point_of_interest") || r.types.includes("establishment"))) {
      return r.formatted_address || (r.address_components && r.address_components[0].long_name) || "";
    }
  }
  // fallback to first result's name / formatted_address
  if (geo.results[0]) {
    return geo.results[0].address_components?.[0]?.long_name || geo.results[0].formatted_address || "";
  }
  return "";
}

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [streaming, setStreaming] = useState(false);

  const [coords, setCoords] = useState(null);
  const [landmark, setLandmark] = useState("");
  const [line2, setLine2] = useState(""); // full address with postcode/state/country
  const [addressRaw, setAddressRaw] = useState("Loading address...");
  const [timeString, setTimeString] = useState("");

  // Attach stream to video when ready (no mirroring)
  useEffect(() => {
    if (videoRef.current && stream) {
      // Ensure video element not mirrored: explicitly remove transforms
      videoRef.current.style.transform = "none";
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // Live time ticker for preview
  useEffect(() => {
    const id = setInterval(() => {
      const now = new Date();
      const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
      const time = to12HourWithSeconds(now);
      const gmt = formatOffset(now.getTimezoneOffset());
      setTimeString(`${date} ${time} GMT ${gmt}`);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Start camera & request location; non-blocking address fetch
  async function startCamera() {
    try {
      // Try environment-facing camera on supported devices
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      setStream(media);
      setStreaming(true);

      // Request geolocation (async)
      if (!navigator.geolocation) {
        setAddressRaw("Location not available");
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude, longitude } = pos.coords;
          setCoords({ latitude, longitude });

          // Prefer Google (if key) for richer place names; else fallback to OSM
          if (GOOGLE_KEY) {
            try {
              // Google reverse geocoding
              const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${GOOGLE_KEY}`;
              const res = await fetch(url);
              const data = await res.json();
              if (data && data.status === "OK") {
                const lm = extractGoogleLandmark(data);
                setLandmark(lm || "");
                // Use formatted_address of first result as line2
                setLine2(data.results?.[0]?.formatted_address || "");
                setAddressRaw(data.results?.[0]?.formatted_address || "");
                return;
              }
            } catch (e) {
              // fall back to OSM
            }
          }

          // OSM fallback: Nominatim
          try {
            const nomUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&addressdetails=1`;
            const r = await fetch(nomUrl, { headers: { "Accept-Language": "en" } });
            const j = await r.json();
            const lm = extractNominatimLandmark(j);
            setLandmark(lm || "");
            const a = j.address || {};
            const parts = [
              a.road,
              a.neighbourhood || a.suburb,
              a.city || a.town || a.village,
              a.state,
              a.postcode,
              a.country,
            ].filter(Boolean);
            setLine2(parts.join(", "));
            setAddressRaw(j.display_name || parts.join(", "));
          } catch (err) {
            setAddressRaw("Unable to fetch address");
            setLine2("");
            setLandmark("");
          }
        },
        (err) => {
          setAddressRaw("Location denied / unavailable");
          setLine2("");
          setLandmark("");
        },
        { enableHighAccuracy: true, timeout: 15000 }
      );
    } catch (e) {
      alert("Camera access error: " + (e?.message || e));
    }
  }

  // Build map URL (Google static if key, else OSM static)
  function buildMapUrl(lat, lon, size = 220) {
    if (!lat || !lon) return null;
    if (GOOGLE_KEY) {
      // Google Static Maps: cap size <=640 (we request 220)
      const marker = `markers=color:red%7C${lat},${lon}`;
      return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lon}&zoom=15&size=${size}x${size}&${marker}&key=${GOOGLE_KEY}&scale=1`;
    } else {
      return `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lon}&zoom=15&size=${size}x${size}&markers=${lat},${lon},red-pushpin`;
    }
  }

  // Utility: load image with CORS attempt
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = url;
    });
  }

  // rounded rect helper
  function roundRect(ctx, x, y, w, h, r) {
    const radius = r || 12;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  // Wrap text helper
  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = String(text || "").split(/\s+/);
    let line = "";
    let curY = y;
    for (let n = 0; n < words.length; n++) {
      const testLine = line ? line + " " + words[n] : words[n];
      const width = ctx.measureText(testLine).width;
      if (width > maxWidth && line) {
        ctx.fillText(line, x, curY);
        line = words[n];
        curY += lineHeight;
      } else {
        line = testLine;
      }
    }
    if (line) ctx.fillText(line, x, curY);
    return curY;
  }

  // Draw stamp ONTO canvas context (for final merge)
  async function drawStampOnCanvas(ctx, canvasW, canvasH) {
    // stamp dims & positions (responsive to canvas)
    const margin = Math.round(Math.min(canvasW, canvasH) * 0.03);
    const stampH = Math.round(Math.min(canvasH * 0.22, 220));
    const stampW = Math.min(canvasW - margin * 2, Math.round(canvasW * 0.86));
    const stampX = margin;
    const stampY = canvasH - stampH - margin;
    // background
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    roundRect(ctx, stampX, stampY, stampW, stampH, 20);
    ctx.fill();
    ctx.restore();

    // map thumbnail left
    const mapSize = Math.min(120, stampH - margin * 2);
    const mapX = stampX + margin;
    const mapY = stampY + margin;
    const lat = coords?.latitude;
    const lon = coords?.longitude;
    const mapUrl = lat && lon ? buildMapUrl(lat, lon, Math.max(120, Math.floor(mapSize))) : null;
    if (mapUrl) {
      try {
        const img = await loadImage(mapUrl);
        ctx.drawImage(img, mapX, mapY, mapSize, mapSize);
      } catch (e) {
        // ignore map load failure
      }
    } else {
      ctx.fillStyle = "#333";
      ctx.fillRect(mapX, mapY, mapSize, mapSize);
    }

    // text area to right
    const textX = mapX + mapSize + margin;
    const textWidth = stampW - (mapSize + margin * 4);
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "top";

    // Line 1: landmark (big)
    ctx.font = `${Math.max(18, Math.round(stampH * 0.14))}px sans-serif`;
    const l1 = landmark || (addressRaw ? addressRaw.split(",")[0] : "Unknown location");
    wrapText(ctx, l1, textX, stampY + margin, textWidth, Math.round(stampH * 0.14) + 6);

    // Line 2: full address (smaller)
    ctx.font = `${Math.max(12, Math.round(stampH * 0.10))}px sans-serif`;
    const line2Y = stampY + margin + Math.round(stampH * 0.14) + 10;
    wrapText(ctx, line2 || addressRaw || "", textX, line2Y, textWidth, Math.round(stampH * 0.10) + 4);

    // Line 3 & 4 at bottom-left of text block
    ctx.font = `${Math.max(12, Math.round(stampH * 0.095))}px monospace`;
    const bottomY = stampY + stampH - margin - Math.round(stampH * 0.095) - 6;
    const latLonStr = lat ? `Lat ${lat.toFixed(6)}° Long ${lon.toFixed(6)}°` : "Lat — Long —";
    ctx.fillText(latLonStr, textX, bottomY);
    ctx.fillText(timeString, textX, bottomY + Math.round(stampH * 0.095) + 6);

    // Draw badge at bottom-right of stamp
    const badgeW = 110;
    const badgeH = 30;
    const badgeX = stampX + stampW - badgeW - margin;
    const badgeY = stampY + stampH - badgeH - margin / 2;
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 8);
    ctx.fill();
    ctx.fillStyle = "#000";
    ctx.font = "bold 13px sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("GPS Map Camera", badgeX + 10, badgeY + badgeH / 2);
    // small dot icon
    ctx.beginPath();
    ctx.arc(badgeX + badgeW - 18, badgeY + badgeH / 2, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Capture + merge + download
  async function captureAndDownload() {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    // Use video natural size for crisp capture if available
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    canvas.width = w;
    canvas.height = h;

    // Draw frame (no mirroring)
    ctx.drawImage(video, 0, 0, w, h);

    // Draw stamp (map + text + badge) on canvas
    await drawStampOnCanvas(ctx, w, h);

    // Download as jpeg
    const url = canvas.toDataURL("image/jpeg", 0.92);
    const a = document.createElement("a");
    a.href = url;
    a.download = `geo-stamped-${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Stamp preview DOM that visually matches the final stamp (preview only)
  function StampPreviewDOM() {
    const lat = coords?.latitude;
    const lon = coords?.longitude;
    const mapUrl = lat && lon ? buildMapUrl(lat, lon, 220) : null;

    return (
      <div className="w-full max-w-xl px-2">
        <div className="bg-black/60 text-white rounded-2xl p-3 flex gap-3 items-start">
          <div className="flex-shrink-0 w-24 h-24 overflow-hidden rounded-md bg-gray-800">
            {mapUrl ? (
              <img src={mapUrl} alt="map" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gray-700" />
            )}
          </div>

          <div className="flex-1">
            <div className="text-xl md:text-2xl font-semibold leading-tight">
              {landmark || (addressRaw ? addressRaw.split(",")[0] : "")}
            </div>
            <div className="text-sm opacity-90 mt-1">{line2}</div>
            <div className="text-sm mt-2">
              Lat {lat ? lat.toFixed(6) : "—"}° Long {lon ? lon.toFixed(6) : "—"}°
            </div>
            <div className="text-sm mt-1">{timeString}</div>
          </div>

          <div className="flex-shrink-0 ml-2">
            <div className="bg-white rounded-md px-3 py-1 text-sm font-bold text-black">GPS Map Camera</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-start bg-gradient-to-b from-slate-900 to-black p-4 md:p-8">
      <div className="w-full max-w-xl">
        <header className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-white">Geo Image Stamp</h1>
          <div className="text-sm text-slate-300">Mobile-like camera</div>
        </header>

        <div className="relative rounded-xl overflow-hidden bg-black shadow-xl">
          {/* Note: do NOT mirror video element - keep transform none */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-[60vh] md:h-[56vh] object-cover bg-black"
            style={{ transform: "none" }}
          />

          <div className="absolute left-0 right-0 bottom-6 flex justify-center pointer-events-none">
            {streaming ? (
              <button
                className="pointer-events-auto w-20 h-20 rounded-full bg-white flex items-center justify-center shadow-2xl border-4 border-white/40"
                onClick={captureAndDownload}
                aria-label="Capture"
                title="Capture"
              >
                <div className="w-14 h-14 rounded-full bg-red-600" />
              </button>
            ) : (
              <button
                onClick={startCamera}
                className="pointer-events-auto px-4 py-2 rounded-lg bg-green-600 text-white shadow"
              >
                Start Camera
              </button>
            )}
          </div>
        </div>

        <div className="mt-4">
          <StampPreviewDOM />
        </div>

        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
}
