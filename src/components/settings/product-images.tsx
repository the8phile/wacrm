'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, ImagePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from '@/lib/storage/upload-media';

interface ProductImage {
  id: string;
  product_name: string;
  image_url: string;
  caption: string | null;
  created_at: string;
}

/**
 * Lets an account owner/admin upload the product photos the AI can
 * send during auto-reply (see [[SEND_IMAGE ...]] in
 * src/lib/ai/defaults.ts and getProductImageContext in
 * src/lib/ai/product-images.ts) — a real upload button here instead
 * of the account needing someone to insert a Storage row/URL
 * manually. Product name must match exactly what a customer would
 * ask for, since the AI only ever sends a photo whose name is in
 * this list.
 */
export function ProductImagesCard({
  accountId,
  canEdit,
}: {
  accountId: string | null;
  canEdit: boolean;
}) {
  const [images, setImages] = useState<ProductImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [productName, setProductName] = useState('');
  const [caption, setCaption] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchImages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/product-images');
      const data = await res.json();
      if (res.ok) setImages(data.images ?? []);
      else toast.error(data.error ?? 'Failed to load product photos');
    } catch {
      toast.error('Failed to load product photos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchImages();
  }, [accountId, fetchImages]);

  const openAdd = () => {
    setAdding(true);
    setProductName('');
    setCaption('');
    setFile(null);
    setPreviewUrl(null);
  };

  const cancelAdd = () => {
    setAdding(false);
    setProductName('');
    setCaption('');
    setFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (!picked) return;
    if (picked.size > MEDIA_MAX_BYTES_BY_KIND.image) {
      toast.error('Photo must be 5 MB or smaller.');
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(picked);
    setPreviewUrl(URL.createObjectURL(picked));
  };

  const save = async () => {
    if (!productName.trim() || !file) {
      toast.error('A product name and a photo are both required.');
      return;
    }
    setSaving(true);
    let uploaded: { publicUrl: string; path: string } | null = null;
    try {
      uploaded = await uploadAccountMedia('product-media', file);
      const res = await fetch('/api/ai/product-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName: productName.trim(),
          imageUrl: uploaded.publicUrl,
          storagePath: uploaded.path,
          caption: caption.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('Product photo added.');
        cancelAdd();
        await fetchImages();
      } else {
        toast.error(data.error ?? 'Failed to save product photo');
        // The file made it to storage but the record failed — clean
        // up rather than leave an orphaned upload behind.
        void deleteAccountMedia('product-media', uploaded.path).catch(() => {});
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save product photo');
      if (uploaded) void deleteAccountMedia('product-media', uploaded.path).catch(() => {});
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/ai/product-images/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Product photo removed.');
        setImages((imgs) => imgs.filter((img) => img.id !== id));
      } else {
        const data = await res.json();
        toast.error(data.error ?? 'Failed to remove product photo');
      }
    } catch {
      toast.error('Failed to remove product photo');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ImagePlus className="size-4" /> Product photos
        </CardTitle>
        <CardDescription>
          Upload a photo for each product — when a customer asks to see it, the AI can send it
          automatically. The product name must match what customers actually call it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {images.length > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {images.map((img) => (
                  <div
                    key={img.id}
                    className="group relative overflow-hidden rounded-lg border border-border"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- account-uploaded photo, not an optimizable static asset */}
                    <img
                      src={img.image_url}
                      alt={img.product_name}
                      className="aspect-square w-full object-cover"
                    />
                    <div className="bg-background/95 px-2 py-1.5">
                      <p className="truncate text-xs font-medium text-foreground">
                        {img.product_name}
                      </p>
                      {img.caption && (
                        <p className="truncate text-[11px] text-muted-foreground">{img.caption}</p>
                      )}
                    </div>
                    {canEdit && (
                      <button
                        onClick={() => remove(img.id)}
                        disabled={deletingId === img.id}
                        aria-label={`Remove ${img.product_name}`}
                        className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-background/90 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 disabled:opacity-50"
                      >
                        {deletingId === img.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {images.length === 0 && !adding && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No product photos yet.
              </p>
            )}

            {adding ? (
              <div className="space-y-3 rounded-lg border border-border p-4">
                <div>
                  <Label htmlFor="product-photo-file">Photo</Label>
                  <input
                    id="product-photo-file"
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleFileChange}
                    className="mt-1.5 block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted/80"
                  />
                  {previewUrl && (
                    <div className="relative mt-2 inline-block">
                      {/* eslint-disable-next-line @next/next/no-img-element -- local preview of an unsent file */}
                      <img
                        src={previewUrl}
                        alt="Preview"
                        className="size-24 rounded-lg border border-border object-cover"
                      />
                      <button
                        onClick={() => {
                          if (previewUrl) URL.revokeObjectURL(previewUrl);
                          setFile(null);
                          setPreviewUrl(null);
                          if (fileInputRef.current) fileInputRef.current.value = '';
                        }}
                        className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-background text-muted-foreground shadow hover:text-destructive"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  )}
                </div>
                <div>
                  <Label htmlFor="product-photo-name">Product name</Label>
                  <Input
                    id="product-photo-name"
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    placeholder="e.g. Plantain chips (large)"
                    maxLength={100}
                    className="mt-1.5"
                />
                </div>
                <div>
                  <Label htmlFor="product-photo-caption">Caption (optional)</Label>
                  <Input
                    id="product-photo-caption"
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="Sent along with the photo"
                    className="mt-1.5"
                />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="ghost" size="sm" onClick={cancelAdd} disabled={saving}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={save} disabled={saving || !productName.trim() || !file}>
                    {saving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              canEdit && (
                <Button variant="outline" size="sm" onClick={openAdd} className="gap-1.5">
                  <Plus className="size-3.5" /> Add product photo
                </Button>
              )
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
