import { Effect, FileSystem, Layer, Option, Path } from "effect";
import {
  MaterialNotFound,
  MaterialRepository,
  MaterialRepositoryError,
  type MaterialPageImages,
  type MaterialRepository as MaterialRepositoryType,
  type PdfMaterial
} from "../../domain/materials/material.ts";
import { PdfService } from "../../domain/materials/pdf-service.ts";

interface PdfFile {
  readonly material: PdfMaterial;
  readonly path: string;
}

/**
 * Turns a file name into an id the agent can pass as a single CLI token.
 *
 * The id used to be the file name verbatim. With a file called
 * `Redes - Fundamentos.pdf` that produced the id `Redes - Fundamentos`, and
 * `materials view <id> <pages>` then needed the id quoted while the page range
 * stayed bare. Watching a real run, the agent burned its whole step budget
 * trying to express that: unquoted (parsed as three arguments), each argument
 * quoted separately, `--help`, and only then the form that works. It had done
 * nothing wrong; the grammar was hostile.
 *
 * Ids are addresses and titles are for people, so they should not be the same
 * string. The title keeps the file name untouched for display.
 */
const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const FileMaterialRepository = {
  make: (directory: string): Effect.Effect<MaterialRepositoryType, never, FileSystem.FileSystem | Path.Path | PdfService> => Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const pdf = yield* PdfService;
    const mapError = (reason: unknown) => new MaterialRepositoryError({ reason });

    const pdfPath = (fileName: string) => path.join(directory, fileName);

    const listFiles = (): Effect.Effect<readonly PdfFile[], MaterialRepositoryError> => Effect.gen(function* () {
      yield* fs.makeDirectory(directory, { recursive: true }).pipe(
        Effect.mapError(mapError)
      );

      const entries = yield* fs.readDirectory(directory).pipe(
        Effect.mapError(mapError)
      );

      return yield* Effect.forEach(
        entries.filter((entry) => path.extname(entry).toLowerCase() === ".pdf").sort(),
        (fileName): Effect.Effect<PdfFile, MaterialRepositoryError> => Effect.gen(function* () {
          const fullPath = pdfPath(fileName);
          const stat = yield* fs.stat(fullPath).pipe(
            Effect.mapError(mapError)
          );
          const baseName = path.basename(fileName, ".pdf");
          const material: PdfMaterial = {
            id: slugify(baseName),
            title: baseName,
            fileName,
            pageCount: yield* pdf.pageCount(fullPath).pipe(Effect.mapError(mapError)),
            uploadedAt: Option.getOrElse(stat.mtime, () => new Date(0)).toISOString()
          };
          return { material, path: fullPath };
        }),
        { concurrency: 1 }
      );
    });

    const getFile = (id: string): Effect.Effect<PdfFile, MaterialNotFound | MaterialRepositoryError> => Effect.gen(function* () {
      const files = yield* listFiles();
      // Also accepts the title, or anything that slugifies to the same id, so a
      // model that reaches for the human-readable name still lands on the right
      // material instead of spending steps discovering the exact form.
      const wanted = slugify(id);
      const found = files.find((file) =>
        file.material.id === id
        || file.material.id === wanted
        || slugify(file.material.title) === wanted
      );
      if (found === undefined) {
        return yield* new MaterialNotFound({ materialId: id });
      }
      return found;
    });

    const list = () => listFiles().pipe(
      Effect.map((files) => files.map((file) => file.material))
    );

    const get = (id: string) => getFile(id).pipe(
      Effect.map((file) => file.material)
    );

    const renderPages = (
      id: string,
      pages: readonly number[]
    ): Effect.Effect<MaterialPageImages, MaterialNotFound | MaterialRepositoryError> => Effect.gen(function* () {
      const file = yield* getFile(id);
      const invalidPage = pages.find((page) => page < 1 || page > file.material.pageCount);
      if (invalidPage !== undefined) {
        return yield* new MaterialRepositoryError({
          reason: `Page ${invalidPage} is outside 1-${file.material.pageCount} for material ${id}`
        });
      }

      const images = yield* Effect.forEach(pages, (page) => pdf.renderPage({ path: file.path, page }).pipe(
        Effect.mapError(mapError)
      ), { concurrency: 1 });

      return {
        type: "material-page-images" as const,
        material: file.material,
        pages: images
      };
    });

    return { list, get, renderPages };
  }),
  layer: (directory: string) => Layer.effect(MaterialRepository)(FileMaterialRepository.make(directory))
};
