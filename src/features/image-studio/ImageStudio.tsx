import React, { useState, useEffect, useCallback } from 'react';
import {
  ImagePlus,
  Download,
  Sparkles,
  Image as ImageIcon,
  Upload,
  X,
  Loader2,
  Trash2,
} from 'lucide-react';
import './ImageStudio.css';
import { supabase } from '../../lib/supabase';

interface ImageStudioProps {
  Logo: React.ComponentType<{ className?: string }>;
}

interface GalleryImage {
  path: string;
  url: string;
  createdAt: string;
}

const ImageStudio: React.FC<ImageStudioProps> = ({ Logo }) => {
  const [prompt, setPrompt] = useState('');
  const [ratio, setRatio] = useState('1:1');
  const [quality, setQuality] = useState('Standard');
  const [imageCount, setImageCount] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [loadingGallery, setLoadingGallery] = useState(true);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [generatedImages, setGeneratedImages] = useState<GalleryImage[]>([]);
  const [selectedPreview, setSelectedPreview] = useState<GalleryImage | null>(null);

  const loadGallery = useCallback(async () => {
    setLoadingGallery(true);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error('Please login to view your images.');
      }

      const { data: files, error: listError } = await supabase.storage
        .from('generated-images')
        .list(user.id, {
          limit: 100,
          sortBy: {
            column: 'created_at',
            order: 'desc',
          },
        });

      if (listError) throw listError;

      const imageFiles = (files || []).filter(
        (file) =>
          file.name &&
          !file.name.startsWith('.') &&
          /\.(jpg|jpeg|png|webp)$/i.test(file.name)
      );

      const images = await Promise.all(
        imageFiles.map(async (file) => {
          const path = `${user.id}/${file.name}`;

          const { data, error } = await supabase.storage
            .from('generated-images')
            .createSignedUrl(path, 3600);

          if (error || !data) {
            console.error('Signed URL error:', error);
            return null;
          }

          return {
            path,
            url: data.signedUrl,
            createdAt: file.created_at || '',
          };
        })
      );

      setGeneratedImages(
        images
          .filter((image): image is GalleryImage => image !== null)
          .sort(
            (a, b) =>
              new Date(b.createdAt).getTime() -
              new Date(a.createdAt).getTime()
          )
      );
    } catch (error) {
      console.error('Gallery loading error:', error);
      alert(
        error instanceof Error
          ? error.message
          : 'Unable to load gallery.'
      );
    } finally {
      setLoadingGallery(false);
    }
  }, []);

  useEffect(() => {
    loadGallery();
  }, [loadGallery]);

  const handleGenerate = async () => {
    if (!prompt.trim() || generating) return;

    setGenerating(true);

    try {
      for (let i = 0; i < imageCount; i++) {
        const { data, error } = await supabase.functions.invoke(
          'generate-image',
          {
            body: {
              prompt: prompt.trim(),
              ratio,
              quality,
            },
          }
        );

        if (error) {
          throw new Error(
            data?.error || error.message || 'Image generation failed.'
          );
        }

        if (!data?.success || !data?.path) {
          throw new Error(
            data?.error || 'Image generation failed.'
          );
        }
      }

      await loadGallery();

    } catch (error) {
      console.error('Image generation error:', error);

      alert(
        error instanceof Error
          ? error.message
          : 'Image generation failed. Please try again.'
      );

      await loadGallery();

    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (image: GalleryImage) => {
    const confirmed = window.confirm(
      'Are you sure you want to permanently delete this image?'
    );

    if (!confirmed) return;

    setDeletingPath(image.path);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error('Please login again.');
      }

      if (!image.path.startsWith(`${user.id}/`)) {
        throw new Error('You cannot delete this image.');
      }

      const { error } = await supabase.storage
        .from('generated-images')
        .remove([image.path]);

      if (error) throw error;

      setGeneratedImages((prev) =>
        prev.filter((item) => item.path !== image.path)
      );

      if (selectedPreview?.path === image.path) {
        setSelectedPreview(null);
      }

    } catch (error) {
      console.error('Image deletion error:', error);

      alert(
        error instanceof Error
          ? error.message
          : 'Unable to delete image.'
      );

    } finally {
      setDeletingPath(null);
    }
  };

  return (
    <div className="image-studio">

      <header className="studio-header">
        <button
          onClick={() =>
            window.dispatchEvent(new Event('prism-back-to-chat'))
          }
          className="text-sm px-3 py-2 rounded-lg border border-gray-500/30 hover:bg-gray-500/10"
        >
          ← Back to Chat
        </button>

        <div>
          <div className="studio-title">
            <Logo className="w-[23px] h-[23px] text-emerald-400" />
            <h1>Image Studio</h1>
          </div>
          <p>Turn your imagination into reality.</p>
        </div>

        <div className="studio-pro-badge flex items-center gap-2">
          <Logo className="w-4 h-4 text-emerald-400" />
          Prism AI
        </div>
      </header>

      <main className="studio-content">

        <section className="generation-panel">

          <div className="generation-heading">
            <h2>Create Images</h2>
            <span>AI Powered Generation</span>
          </div>

          <div className="prompt-container">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the image you want to create..."
              rows={5}
              maxLength={2048}
            />

            <div className="prompt-footer">
              <label className="upload-button">
                <Upload size={17} />
                Upload Image

                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) =>
                    setSelectedImage(e.target.files?.[0] || null)
                  }
                />
              </label>

              <span>{prompt.length}/2048</span>
            </div>

            {selectedImage && (
              <div className="selected-file">
                <ImageIcon size={16} />
                {selectedImage.name}

                <button onClick={() => setSelectedImage(null)}>
                  <X size={15} />
                </button>
              </div>
            )}
          </div>

          <div className="studio-options">

            <div className="option-group">
              <label>Aspect Ratio</label>
              <select
                value={ratio}
                onChange={(e) => setRatio(e.target.value)}
                disabled={generating}
              >
                <option value="1:1">Square (1:1)</option>
                <option value="16:9">Landscape (16:9)</option>
                <option value="9:16">Portrait (9:16)</option>
                <option value="4:3">Classic (4:3)</option>
              </select>
            </div>

            <div className="option-group">
              <label>Quality</label>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                disabled={generating}
              >
                <option value="Standard">Standard</option>
                <option value="HD">HD</option>
              </select>
            </div>

            <div className="option-group">
              <label>Images</label>
              <select
                value={imageCount}
                onChange={(e) =>
                  setImageCount(Number(e.target.value))
                }
                disabled={generating}
              >
                <option value={1}>1 Image</option>
                <option value={2}>2 Images</option>
                <option value={3}>3 Images</option>
                <option value={4}>4 Images</option>
              </select>
            </div>

          </div>

          <button
            className="generate-button"
            onClick={handleGenerate}
            disabled={!prompt.trim() || generating}
          >
            {generating ? (
              <Loader2 className="spin" size={19} />
            ) : (
              <Sparkles size={19} />
            )}

            {generating ? 'Generating...' : 'Generate Image'}
          </button>

        </section>

        <section className="gallery-section">

          <div className="gallery-heading">
            <div>
              <h2>Generated Images</h2>
              <p>Your creative collection</p>
            </div>

            <span className="gallery-count">
              {generatedImages.length} Images
            </span>
          </div>

          {loadingGallery ? (
            <div className="gallery-empty">
              <Loader2 className="spin" size={30} />
              <p>Loading your images...</p>
            </div>
          ) : generatedImages.length === 0 ? (
            <div className="gallery-empty">
              <div className="empty-icon">
                <ImagePlus size={38} />
              </div>

              <h3>Your creativity starts here</h3>

              <p>
                Enter a prompt above and generate your first
                AI image with Prism AI.
              </p>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: '16px',
              }}
            >
              {generatedImages.map((image) => (
                <div
                  key={image.path}
                  style={{
                    position: 'relative',
                    borderRadius: '12px',
                    overflow: 'hidden',
                  }}
                >
                  <img
                    src={image.url}
                    alt="Generated image"
                    onClick={() => setSelectedPreview(image)}
                    style={{
                      width: '100%',
                      borderRadius: '12px',
                      cursor: 'zoom-in',
                      display: 'block',
                    }}
                  />

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 4px',
                    }}
                  >
                    <a
                      href={image.url}
                      download="prism-ai-image.jpg"
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <Download size={16} />
                      Download
                    </a>

                    <button
                      onClick={() => handleDelete(image)}
                      disabled={deletingPath === image.path}
                      title="Delete image permanently"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        color: '#ef4444',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        opacity:
                          deletingPath === image.path ? 0.5 : 1,
                      }}
                    >
                      {deletingPath === image.path ? (
                        <Loader2 className="spin" size={16} />
                      ) : (
                        <Trash2 size={16} />
                      )}
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

        </section>

        {selectedPreview && (
          <div
            onClick={() => setSelectedPreview(null)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9999,
              background: 'rgba(0,0,0,0.92)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '30px',
            }}
          >
            <button
              onClick={() => setSelectedPreview(null)}
              style={{
                position: 'absolute',
                top: '20px',
                right: '30px',
                fontSize: '32px',
                color: 'white',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              ×
            </button>

            <img
              src={selectedPreview.url}
              alt="Full size preview"
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: '95%',
                maxHeight: '90vh',
                objectFit: 'contain',
                borderRadius: '12px',
              }}
            />

            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(selectedPreview);
              }}
              disabled={deletingPath === selectedPreview.path}
              style={{
                position: 'absolute',
                bottom: '20px',
                right: '30px',
                color: 'white',
                background: '#dc2626',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 16px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <Trash2 size={17} />
              Delete Image
            </button>
          </div>
        )}

      </main>
    </div>
  );
};

export default ImageStudio;