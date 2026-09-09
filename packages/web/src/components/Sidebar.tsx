import { useAtomSet, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { type ReactNode, useState } from "react";
import { apiClientConfig } from "../api-client/config.ts";
import { artifactsQuery } from "../domain/artifacts/atoms.ts";
import { materialsQuery } from "../domain/materials/atoms.ts";
import { clearProfileAction, forgetProfileNoteAction, profileQuery } from "../domain/profile/atoms.ts";

interface SidebarProps {
  readonly selectedArtifactId: string | null;
  readonly onSelectArtifact: (artifactId: string) => void;
}

type Section = "materials" | "artifacts" | "memory";

const kindLabels: Record<string, string> = {
  note: "nota",
  quiz: "quiz",
  test: "test"
};

const kindStyles: Record<string, string> = {
  note: "bg-slate-800 text-slate-400",
  quiz: "bg-violet-500/15 text-violet-500",
  test: "bg-fuchsia-500/15 text-fuchsia-500"
};

const noteKindLabels: Record<string, string> = {
  context: "contexto",
  gap: "a reforzar",
  strength: "lo domina",
  preference: "prefiere"
};

const noteKindStyles: Record<string, string> = {
  context: "bg-slate-800 text-slate-400",
  gap: "bg-amber-500/15 text-amber-600",
  strength: "bg-emerald-500/15 text-emerald-600",
  preference: "bg-violet-500/15 text-violet-500"
};

const noteSourceLabels: Record<string, string> = {
  quiz: "de un quiz",
  debate: "de un debate",
  chat: "de una conversación"
};

export function Sidebar({ selectedArtifactId, onSelectArtifact }: SidebarProps) {
  const materials = useAtomValue(materialsQuery);
  const artifacts = useAtomValue(artifactsQuery);
  const profile = useAtomValue(profileQuery);
  const forgetNote = useAtomSet(forgetProfileNoteAction, { mode: "promise" });
  const clearProfile = useAtomSet(clearProfileAction, { mode: "promise" });
  const [section, setSection] = useState<Section>("materials");

  const materialCount = AsyncResult.isSuccess(materials) ? materials.value.materials.length : undefined;
  const artifactCount = AsyncResult.isSuccess(artifacts) ? artifacts.value.artifacts.length : undefined;
  const noteCount = AsyncResult.isSuccess(profile) ? profile.value.notes.length : undefined;

  return (
    <aside className="flex h-screen flex-col overflow-hidden border-slate-800 border-r bg-slate-900 max-md:h-auto max-md:max-h-[45vh] max-md:border-r-0 max-md:border-b">
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-6">
        <ProxusMark />
        <span className="font-bold text-lg text-slate-100 tracking-[0.18em]">PROXUS</span>
      </div>

      {/*
        A vertical rail rather than tabs, matching the rest of the product.
        These are the three things the app actually has; inventing menu entries
        that lead nowhere would look closer to the real thing and be worse to
        use.
      */}
      <nav className="flex flex-col gap-0.5 px-3">
        <NavItem
          label="Materiales"
          count={materialCount}
          active={section === "materials"}
          onClick={() => setSection("materials")}
          icon={<DocumentIcon />}
        />
        <NavItem
          label="Estudio"
          count={artifactCount}
          active={section === "artifacts"}
          onClick={() => setSection("artifacts")}
          icon={<CardsIcon />}
        />
        <NavItem
          label="Memoria"
          count={noteCount}
          active={section === "memory"}
          onClick={() => setSection("memory")}
          icon={<SparkIcon />}
        />
      </nav>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        {section === "materials" && AsyncResult.matchWithError(materials, {
          onInitial: () => <Hint>Cargando materiales…</Hint>,
          onError: (error) => <ErrorHint>{String(error)}</ErrorHint>,
          onDefect: (defect) => <ErrorHint>{String(defect)}</ErrorHint>,
          onSuccess: ({ value }) => value.materials.length === 0
            ? <EmptyHint>Aún no has subido ningún PDF.</EmptyHint>
            : (
                <ul className="grid gap-1.5">
                  {value.materials.map((material) => (
                    <li key={material.id}>
                      <a
                        className="group flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 transition-colors hover:border-violet-400"
                        href={`${apiClientConfig.apiUrl}/api/materials/${encodeURIComponent(material.id)}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Abrir el PDF en una pestaña nueva"
                      >
                        <span className="text-violet-500"><DocumentIcon /></span>
                        <span className="min-w-0 flex-1">
                          <strong className="block truncate font-medium text-slate-100 text-sm">{material.title}</strong>
                          <span className="mt-0.5 block text-slate-500 text-xs">{material.pageCount} págs.</span>
                        </span>
                        <ArrowUpRightIcon />
                      </a>
                    </li>
                  ))}
                </ul>
              )
        })}

        {section === "artifacts" && AsyncResult.matchWithError(artifacts, {
          onInitial: () => <Hint>Cargando…</Hint>,
          onError: (error) => <ErrorHint>{String(error)}</ErrorHint>,
          onDefect: (defect) => <ErrorHint>{String(defect)}</ErrorHint>,
          onSuccess: ({ value }) => value.artifacts.length === 0
            ? <EmptyHint>Aún no hay notas, quizzes ni tests.</EmptyHint>
            : (
                <ul className="grid gap-1.5">
                  {value.artifacts.map((artifact) => (
                    <li key={artifact.id}>
                      <button
                        className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                          selectedArtifactId === artifact.id
                            ? "border-violet-400 bg-violet-500/10"
                            : "border-slate-800 bg-slate-900 hover:border-violet-400"
                        }`}
                        type="button"
                        onClick={() => onSelectArtifact(artifact.id)}
                      >
                        <strong className="block truncate font-medium text-slate-100 text-sm">{artifact.title}</strong>
                        <span className={`mt-1 inline-block rounded-full px-2 py-0.5 font-medium text-[11px] uppercase tracking-wide ${kindStyles[artifact.kind] ?? "bg-slate-800 text-slate-400"}`}>
                          {kindLabels[artifact.kind] ?? artifact.kind}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
        })}

        {section === "memory" && AsyncResult.matchWithError(profile, {
          onInitial: () => <Hint>Cargando…</Hint>,
          onError: (error) => <ErrorHint>{String(error)}</ErrorHint>,
          onDefect: (defect) => <ErrorHint>{String(defect)}</ErrorHint>,
          onSuccess: ({ value }) => (
            <div className="grid gap-3">
              <p className="px-1 text-slate-500 text-xs leading-5">
                Esto es lo que MagIA recuerda de ti entre conversaciones. Puedes borrar
                lo que no quieras que tenga en cuenta.
              </p>

              {value.notes.length === 0
                ? <EmptyHint>Todavía no sé nada de ti.</EmptyHint>
                : (
                    <>
                      <ul className="grid gap-1.5">
                        {value.notes.map((note) => (
                          <li key={note.id} className="group rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5">
                            <div className="flex items-start justify-between gap-2">
                              <span className={`inline-block rounded-full px-2 py-0.5 font-medium text-[11px] ${noteKindStyles[note.kind] ?? "bg-slate-800 text-slate-400"}`}>
                                {noteKindLabels[note.kind] ?? note.kind}
                              </span>
                              <button
                                type="button"
                                className="shrink-0 rounded-md p-1 text-slate-500 opacity-0 transition-opacity hover:text-red-500 focus:opacity-100 group-hover:opacity-100"
                                aria-label={`Olvidar: ${note.topic}`}
                                title="Que MagIA olvide esto"
                                onClick={() => void forgetNote(note.id)}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                                </svg>
                              </button>
                            </div>
                            <strong className="mt-2 block font-medium text-slate-100 text-sm">{note.topic}</strong>
                            <span className="mt-0.5 block text-slate-400 text-sm">{note.detail}</span>
                            <span className="mt-1 block text-slate-500 text-xs">
                              {noteSourceLabels[note.source] ?? note.source}
                            </span>
                          </li>
                        ))}
                      </ul>

                      <button
                        type="button"
                        className="rounded-xl border border-slate-800 border-dashed px-3 py-2 text-slate-500 text-sm transition-colors hover:border-red-400 hover:text-red-500"
                        onClick={() => void clearProfile()}
                      >
                        Borrar todo lo que recuerda
                      </button>
                    </>
                  )}
            </div>
          )
        })}
      </div>
    </aside>
  );
}

function NavItem({ label, count, active, onClick, icon }: {
  readonly label: string;
  readonly count: number | undefined;
  readonly active: boolean;
  readonly onClick: () => void;
  readonly icon: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active}
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 font-medium text-sm transition-colors ${
        active
          ? "bg-violet-500/10 text-violet-600"
          : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
      }`}
    >
      <span className={active ? "text-violet-500" : "text-slate-500"}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {count === undefined ? null : (
        <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${active ? "bg-violet-500/15 text-violet-600" : "bg-slate-800 text-slate-400"}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function Hint({ children }: { readonly children: ReactNode }) {
  return <p className="px-1 text-slate-500 text-sm">{children}</p>;
}

function ErrorHint({ children }: { readonly children: ReactNode }) {
  return <p className="px-1 text-red-500 text-sm">{children}</p>;
}

function EmptyHint({ children }: { readonly children: string }) {
  return (
    <div className="rounded-xl border border-slate-800 border-dashed px-4 py-6 text-center text-slate-500 text-sm">
      {children}
    </div>
  );
}

function ProxusMark() {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 4 19 20" />
        <path d="M19 4 5 20" />
      </svg>
    </span>
  );
}

function DocumentIcon() {
  return (
    <svg className="shrink-0" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function CardsIcon() {
  return (
    <svg className="shrink-0" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="7" width="13" height="14" rx="2" />
      <path d="M8 3h11a2 2 0 0 1 2 2v11" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg className="shrink-0" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
    </svg>
  );
}

function ArrowUpRightIcon() {
  return (
    <svg className="shrink-0 text-slate-500 transition-colors group-hover:text-violet-500" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17 17 7" />
      <path d="M7 7h10v10" />
    </svg>
  );
}
