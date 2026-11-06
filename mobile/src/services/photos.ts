import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Album, Asset, requestPermissionsAsync } from 'expo-media-library';

export const ALBUM_NAME = 'Тропа';

/**
 * Сохраняет фото квеста в отдельный альбом «Тропа» в галерее.
 * Возвращает адрес снимка в галерее — он, в отличие от кэша камеры, не пропадёт.
 */
export async function savePhotoToAlbum(uri: string): Promise<string | null> {
  const perm = await requestPermissionsAsync(true, ['photo']);
  if (!perm.granted) return null;
  const album = await Album.get(ALBUM_NAME);
  const asset = await Asset.create(uri, album ?? undefined);
  // На Android пустой альбом создать нельзя — создаём его вместе с первым снимком
  if (!album) await Album.create(ALBUM_NAME, [asset], true);
  try {
    return await asset.getUri();
  } catch {
    return null;
  }
}

/** Маленькая миниатюра (base64) — для метки на карте; хранится вместе с историей квестов. */
export async function makeThumbnail(uri: string, width = 112): Promise<string | null> {
  const ctx = ImageManipulator.manipulate(uri);
  ctx.resize({ width });
  const img = await ctx.renderAsync();
  const res = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.6, base64: true });
  return res.base64 ? `data:image/jpeg;base64,${res.base64}` : null;
}
