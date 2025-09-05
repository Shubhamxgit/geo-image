import React, { useEffect, useRef, useState } from "react";

/**
 * Robust Geo Camera (React + Tailwind)
 * - Put optional Google API key in .env as VITE_GOOGLE_MAPS_KEY
 * - Falls back to OpenStreetMap (Nominatim + staticmap) when no key
 *
 * Notes:
 * - For map images: we attempt to fetch as blob (CORS-aware) and draw via createImageBitmap.
 *   If fetch/bitmap fails we still save the photo without the map thumb.
 * - Orientation: uses screen.orientation.angle or window.orientation when available.
 */

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
function to12HourWithSeconds(d) {
  let h = d.getHours();
  const m = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${pad(h)}:${m}:${s} ${ampm}`;
}

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [stream, setStream] = useState(null);

  const [coords, setCoords] = useState(null);
  const [landmark, setLandmark] = useState("");
  const [line2, setLine2] = useState("");
  const [addressRaw, setAddressRaw] = useState("Loading address...");
  const [mapUrl, setMapUrl] = useState(null);
  const [timeString, setTimeString] = useState("");
  const [error, setError] = useState(null);
  const [loadingAddress, setLoadingAddress] = useState(false);

  // Start camera on mount (user will be prompted)
  useEffect(() => {
    async function start() {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        setStream(s);
        if (videoRef.current) {
          videoRef.current.srcObject = s;
        }
      } catch (e) {
        setError("Camera access denied or not available: " + (e?.message || e));
      }
    }

    start();

    // update clock
    const id = setInterval(() => {
      const now = new Date();
      const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
      const time = to12HourWithSeconds(now);
      const gmt = formatOffset(now.getTimezoneOffset());
      setTimeString(`${date} ${time} GMT ${gmt}`);
    }, 1000);

    return () => {
      clearInterval(id);
      // cleanup stream on unmount
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Request geolocation separately (non-blocking)
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setAddressRaw("Geolocation not supported");
      return;
    }
    setLoadingAddress(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setCoords({ latitude, longitude });

        // build map url (use Google if key supplied)
        if (GOOGLE_KEY) {
          setMapUrl(
            `https://maps.googleapis.com/maps/api/staticmap?center=${latitude},${longitude}&zoom=15&size=300x300&markers=color:red%7C${latitude},${longitude}&key=${GOOGLE_KEY}`
          );
        } else {
          setMapUrl(
            `https://staticmap.openstreetmap.de/staticmap.php?center=${latitude},${longitude}&zoom=15&size=300x300&markers=${latitude},${longitude},red-pushpin`
          );
        }

        // reverse-geocode: prefer Google geocode (if key), fallback to nominatim
        try {
          if (GOOGLE_KEY) {
            const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${GOOGLE_KEY}`;
            const r = await fetch(url);
            const j = await r.json();
            if (j.status === "OK" && j.results && j.results.length) {
              const first = j.results[0];
              // try to find a POI-like result
              const poi = j.results.find((res) => res.types && (res.types.includes("establishment") || res.types.includes("point_of_interest")));
              const top = poi || first;
              const name = top.formatted_address || (top.address_components && top.address_components[0]?.long_name) || "";
              setLandmark(name.split(",")[0] || "");
              setLine2(first.formatted_address || "");
              setAddressRaw(first.formatted_address || name || "");
              setLoadingAddress(false);
              return;
            }
          }

          // fallback: Nominatim
          const nom = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&addressdetails=1`;
          const res = await fetch(nom, { headers: { "Accept-Language": "en" } });
          const data = await res.json();
          const a = data.address || {};
          const prefer = a.attraction || a.building || a.leisure || a.city || a.town || a.village || a.suburb || a.road || "";
          setLandmark(prefer || "");
          const parts = [a.road, a.neighbourhood || a.suburb, a.city || a.town || a.village, a.state, a.postcode, a.country]
            .filter(Boolean)
            .join(", ");
          setLine2(parts);
          setAddressRaw(data.display_name || parts || "");
        } catch (e) {
          setAddressRaw("Unable to fetch address");
        } finally {
          setLoadingAddress(false);
        }
      },
      (err) => {
        setAddressRaw("Location denied/unavailable");
        setLoadingAddress(false);
      },
      { enableHighAccuracy: true, timeout: 20000 }
    );
  }, []);

  // helper: draw rounded rect
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // helper: wrap text
  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = String(text || "").split(/\s+/);
    let line = "";
    let curY = y;
    for (let n = 0; n < words.length; n++) {
      const testLine = line ? line + " " + words[n] : words[n];
      const w = ctx.measureText(testLine).width;
      if (w > maxWidth && line) {
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

  // Draw stamp panel programmatically on canvas (avoids foreignObject)
  async function drawStampOnCanvas(ctx, canvasW, canvasH) {
    const margin = Math.round(Math.min(canvasW, canvasH) * 0.03);
    const stampH = Math.round(Math.min(canvasH * 0.22, 220));
    const stampW = Math.min(canvasW - margin * 2, Math.round(canvasW * 0.86));
    const stampX = margin;
    const stampY = canvasH - stampH - margin;
    const radius = Math.round(margin * 0.5);

    // background
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    roundRect(ctx, stampX, stampY, stampW, stampH, radius);
    ctx.fill();
    ctx.restore();

    // map image left
    const padding = Math.round(stampH * 0.12);
    const mapSize = Math.min(120, stampH - padding * 2);
    const mapX = stampX + padding;
    const mapY = stampY + padding;

    let mapBitmap = null;
    if (mapUrl) {
      try {
        // attempt to fetch map as blob and createImageBitmap (CORS-aware)
        const resp = await fetch(mapUrl, { mode: "cors" });
        if (resp.ok) {
          const blob = await resp.blob();
          mapBitmap = await createImageBitmap(blob);
          ctx.drawImage(mapBitmap, mapX, mapY, mapSize, mapSize);
        } else {
          // ignore
        }
      } catch (e) {
        // fetching map failed (CORS or network) -> fallback to placeholder
      }
    }
    if (!mapBitmap) {
      // placeholder box
      ctx.fillStyle = "#2b2b2b";
      ctx.fillRect(mapX, mapY, mapSize, mapSize);
      // small pin
      ctx.fillStyle = "#c0392b";
      ctx.beginPath();
      ctx.arc(mapX + mapSize / 2, mapY + mapSize / 2 - 10, 8, 0, Math.PI * 2);
      ctx.fill();
    }

    // text area
    const textX = mapX + mapSize + padding;
    const textWidth = stampW - (mapSize + padding * 4);
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "top";

    // line 1: landmark large
    const l1 = landmark || (addressRaw ? addressRaw.split(",")[0] : "Unknown location");
    ctx.font = `${Math.max(18, Math.round(stampH * 0.14))}px sans-serif`;
    wrapText(ctx, l1, textX, stampY + padding - 2, textWidth, Math.round(stampH * 0.14) + 6);

    // line2: full address smaller
    ctx.font = `${Math.max(12, Math.round(stampH * 0.10))}px sans-serif`;
    const line2Y = stampY + padding + Math.round(stampH * 0.14) + 6;
    wrapText(ctx, line2 || addressRaw || "", textX, line2Y, textWidth, Math.round(stampH * 0.10) + 4);

    // coords & time bottom-left of text area
    ctx.font = `${Math.max(12, Math.round(stampH * 0.095))}px monospace`;
    const bottomY = stampY + stampH - padding - Math.round(stampH * 0.095) - 2;
    const latStr = coords ? `Lat ${coords.latitude.toFixed(6)}° Long ${coords.longitude.toFixed(6)}°` : "Lat — Long —";
    ctx.fillText(latStr, textX, bottomY);
    ctx.fillText(timeString, textX, bottomY + Math.round(stampH * 0.095) + 6);

    // badge on bottom-right
    const badgeW = 120;
    const badgeH = 32;
    const badgeX = stampX + stampW - badgeW - padding;
    const badgeY = stampY + stampH - badgeH - padding / 2;
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 8);
    ctx.fill();
    ctx.fillStyle = "#000";
    ctx.font = "bold 12px sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("GPS Map Camera", badgeX + 10, badgeY + badgeH / 2);
    // small dot
    ctx.beginPath();
    ctx.arc(badgeX + badgeW - 18, badgeY + badgeH / 2, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Compute device orientation angle safely
  function getOrientationAngle() {
    try {
      if (screen && screen.orientation && typeof screen.orientation.angle === "number") {
        return screen.orientation.angle;
      }
      if (typeof window.orientation === "number") return window.orientation;
    } catch (e) {}
    return 0;
  }

  // Capture: draws video frame (with rotation if needed) + stamp panel and saves
  async function captureAndDownload() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d");

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) {
      alert("Video not ready yet — try again in a second");
      return;
    }

    const angle = ((getOrientationAngle() % 360) + 360) % 360; // 0,90,180,270

    // If device is rotated by 90/270 => swap canvas dims and rotate drawing
    if (angle === 90 || angle === 270) {
      canvas.width = vh;
      canvas.height = vw;
      ctx.save();
      // translate to center, rotate, then draw video centered
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((angle * Math.PI) / 180);
      // draw video centered (video width = vw, height = vh)
      ctx.drawImage(video, -vw / 2, -vh / 2, vw, vh);
      ctx.restore();
    } else {
      // angle 0 or 180
      canvas.width = vw;
      canvas.height = vh;
      if (angle === 180) {
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(Math.PI);
        ctx.drawImage(video, -vw / 2, -vh / 2, vw, vh);
        ctx.restore();
      } else {
        ctx.drawImage(video, 0, 0, vw, vh);
      }
    }

    // draw overlay (stamp)
    try {
      await drawStampOnCanvas(ctx, canvas.width, canvas.height);
    } catch (e) {
      // still continue
      console.warn("Stamp draw failed:", e);
    }

    // Save (always)
    const mime = "image/jpeg";
    const url = canvas.toDataURL(mime, 0.92);
    const a = document.createElement("a");
    a.href = url;
    a.download = `geo-stamped-${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // UI: show helpful messages if permissions blocked
  const permissionHint =
    error ||
    (!stream ? "Waiting for camera permission..." : "") ||
    (loadingAddress ? "Fetching location..." : "");

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden">
      {/* fullscreen video (shows what's being captured) */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-screen h-screen object-cover pointer-events-none"
      />

      {/* top hint */}
      {permissionHint && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-black/60 text-white px-4 py-2 rounded z-50">
          {permissionHint}
        </div>
      )}

      {/* Live overlay (visually identical to final stamp) */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[92%] max-w-3xl z-40 pointer-events-none">
        <div className="w-full bg-black/80 text-white rounded-2xl p-3 flex items-center gap-3">
          {/* map */}
          <div className="w-20 h-20 rounded overflow-hidden bg-gray-800 flex items-center justify-center">
            {mapUrl ? (
              // normal <img> used only for preview; final canvas uses fetched blob separately
              <img src={mapUrl} alt="map" className="w-full h-full object-cover" />
            ) : (
              <div className="w-8 h-8 bg-red-600 rounded-full" />
            )}
          </div>

          {/* address text */}
          <div className="flex-1">
            <div className="text-2xl font-semibold leading-tight">
              {landmark || (addressRaw ? addressRaw.split(",")[0] : "Unknown")}
            </div>
            <div className="text-sm opacity-90 mt-1">{line2}</div>
            <div className="text-sm mt-2">
              {coords ? `Lat ${coords.latitude.toFixed(6)}° Long ${coords.longitude.toFixed(6)}°` : "Lat — Long —"}
            </div>
            <div className="text-sm mt-1">{timeString}</div>
          </div>

          {/* badge/logo */}
          <div className="flex-shrink-0">
            <div className="bg-white rounded-md px-3 py-1 text-sm font-bold text-black">GPS Map Camera</div>
          </div>
        </div>
      </div>

      {/* shutter button (clickable) */}
      <button
        onClick={captureAndDownload}
        className="absolute bottom-28 left-1/2 -translate-x-1/2 z-50 w-24 h-24 rounded-full bg-white/90 border-4 border-white/60 flex items-center justify-center active:scale-95"
        aria-label="Capture"
        title="Capture"
      >
        <span className="w-16 h-16 rounded-full bg-red-600 block" />
      </button>

      {/* hidden canvas used for final composition */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
