import React, { useEffect, useRef, useState } from "react";
import { BottomSheet } from "./components";
import { Icon } from "./icons";
import { addPhoto, listPhotos, removePhoto } from "./photoStore";

function PhotoCard({ photo, onRemove }) {
  const [url, setUrl] = useState("");
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    const next = URL.createObjectURL(photo.blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [photo]);
  return <article className="photo-card">
    {url ? <img src={url} alt={photo.type === "progress" ? "Private progress photo" : "Goal physique reference"} /> : null}
    <div><strong>{photo.type === "progress" ? "Progress" : "Goal reference"}</strong><small>{new Date(photo.createdAt).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" })}</small></div>
    {confirming ? <div className="remove-confirm"><button onClick={() => setConfirming(false)}>Keep</button><button onClick={() => onRemove(photo.id)}>Remove</button></div> : <button className="photo-remove" onClick={() => setConfirming(true)}>Remove</button>}
  </article>;
}

export function PhotoSheet({ onClose }) {
  const progressInput = useRef(null);
  const referenceInput = useRef(null);
  const [photos, setPhotos] = useState([]);
  const [status, setStatus] = useState("loading");

  const refresh = () => listPhotos().then((items) => { setPhotos(items); setStatus("ready"); }).catch(() => setStatus("error"));
  useEffect(() => { refresh(); }, []);

  const handleFile = async (event, type) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setStatus("saving");
    try { await addPhoto(file, type); await refresh(); } catch { setStatus("error"); }
  };
  const handleRemove = async (id) => { await removePhoto(id); await refresh(); };

  return <BottomSheet title="Goal physique & progress" onClose={onClose}>
    <p className="sheet-lead">References and progress photos stay private in this browser and never appear on the dashboard automatically.</p>
    <div className="sheet-actions photo-actions">
      <button className="primary-button" onClick={() => progressInput.current?.click()}><Icon name="camera" size={18} /> Add progress photo</button>
      <button className="secondary-button" onClick={() => referenceInput.current?.click()}><Icon name="sparkle" size={18} /> Add goal reference</button>
      <input ref={progressInput} hidden type="file" accept="image/*" onChange={(event) => handleFile(event, "progress")} />
      <input ref={referenceInput} hidden type="file" accept="image/*" onChange={(event) => handleFile(event, "reference")} />
    </div>
    {status === "saving" ? <p className="storage-note" role="status" aria-live="polite">Saving privately…</p> : null}
    {status === "error" ? <p className="form-error" role="alert">Photos could not be stored in this browser.</p> : null}
    {status === "ready" && !photos.length ? <div className="empty-state"><Icon name="camera" size={28} /><strong>No photos yet</strong><span>Add a reference or progress photo when you are ready. No reminders.</span></div> : null}
    {photos.length ? <div className="photo-grid">{photos.map((photo) => <PhotoCard key={photo.id} photo={photo} onRemove={handleRemove} />)}</div> : null}
  </BottomSheet>;
}
