import { useEffect, useRef, useState } from "react";

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const [streaming, setStreaming] = useState(false);
  const [coords, setCoords] = useState(null);
  const [address, setAddress] = useState("Loading address...");
  const [timeString, setTimeString] = useState("");
  const [mapUrl, setMapUrl] = useState("");

  // Start camera
  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }, // back camera if available
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      setStreaming(true);
    } catch (err) {
      alert("Camera error: " + err.message);
    }
  };

  // Live time updater
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const date = now.toLocaleDateString("en-GB");
      const time = now.toLocaleTimeString("en-US", { hour12: true });
      const offsetMinutes = now.getTimezoneOffset();
      const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
      const offsetMins = Math.abs(offsetMinutes) % 60;
      const gmt = `GMT ${offsetMinutes > 0 ? "-" : "+"}${offsetHours}:${String(
        offsetMins
      ).padStart(2, "0")}`;
      setTimeString(`${date} ${time} ${gmt}`);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Get location
  const fetchLocation = () => {
    if (!navigator.geolocation) {
      setAddress("Geolocation not supported");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setCoords({ latitude, longitude });

        // Fallback: OpenStreetMap Nominatim
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`
          );
          const data = await res.json();
          const addr = data.address || {};
          const line1 =
            addr.attraction ||
            addr.building ||
            addr.neighbourhood ||
            addr.suburb ||
            addr.city ||
            addr.town ||
            addr.village ||
            "Unknown Place";
          const line2 = `${addr.road || ""}, ${addr.city || ""}, ${
            addr.state || ""
          }, ${addr.postcode || ""}, ${addr.country || ""}`;
          setAddress(`${line1}\n${line2}`);
        } catch (e) {
          setAddress("Address not found");
        }

        // Free static map (OSM)
        setMapUrl(
          `https://staticmap.openstreetmap.de/staticmap.php?center=${latitude},${longitude}&zoom=15&size=300x200&markers=${latitude},${longitude},red-pushpin`
        );
      },
      (err) => {
        setAddress("Location error: " + err.message);
      }
    );
  };

  // Start both camera + location once app loads
  useEffect(() => {
    startCamera();
    fetchLocation();
  }, []);

  // Capture snapshot
  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    // Set canvas size
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight + 180; // extra for stamp panel

    // Draw video frame
    ctx.drawImage(video, 0, 0, canvas.width, video.videoHeight);

    // Stamp panel background
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, video.videoHeight, canvas.width, 180);

    // Draw map thumbnail
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      ctx.drawImage(img, 10, video.videoHeight + 10, 140, 120);

      // Text
      ctx.fillStyle = "white";
      ctx.font = "18px Arial";
      const lines = address.split("\n");
      lines.forEach((line, i) => {
        ctx.fillText(line, 170, video.videoHeight + 40 + i * 24);
      });

      if (coords) {
        ctx.fillText(
          `Lat: ${coords.latitude.toFixed(5)}°, Lon: ${coords.longitude.toFixed(5)}°`,
          170,
          video.videoHeight + 90
        );
      }

      ctx.fillText(timeString, 170, video.videoHeight + 120);

      // Logo (just text placeholder, you can replace with image)
      ctx.fillText("GPS Map Camera", canvas.width - 200, video.videoHeight + 120);

      // Download
      const link = document.createElement("a");
      link.download = "geo-stamped-photo.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
    };
    img.src = mapUrl;
  };

  return (
    <div className="flex flex-col items-center bg-black min-h-screen text-white">
      <h1 className="text-xl font-bold p-4">📷 Geo Camera</h1>

      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full max-w-md rounded-xl bg-black"
      />

      {/* Stamp panel below video */}
      <div className="w-full max-w-md bg-black/60 text-white rounded-xl p-3 mt-2 text-sm">
        {address.split("\n").map((line, i) => (
          <p key={i}>{line}</p>
        ))}
        {coords && (
          <p>
            Lat: {coords.latitude.toFixed(5)}°, Lon: {coords.longitude.toFixed(5)}°
          </p>
        )}
        <p>{timeString}</p>
      </div>

      {/* Capture button */}
      <button
        onClick={capturePhoto}
        className="w-20 h-20 mt-4 rounded-full bg-red-600 border-4 border-white shadow-lg active:scale-95"
      />

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

export default App;
