import { ExternalLink, FileDown } from "lucide-react";

export function actaDownloadUrl(actaObjectPath: string): string {
  return `/api/storage${actaObjectPath}`;
}

export function SessionResources({
  meetingLink,
  actaObjectPath,
  actaFileName,
  className = "",
}: {
  meetingLink?: string | null;
  actaObjectPath?: string | null;
  actaFileName?: string | null;
  className?: string;
}) {
  if (!meetingLink && !actaObjectPath) return null;

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {meetingLink && (
        <a
          href={meetingLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-100"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Enlace de la sesión
        </a>
      )}
      {actaObjectPath && (
        <a
          href={actaDownloadUrl(actaObjectPath)}
          download={actaFileName ?? undefined}
          className="inline-flex items-center gap-1.5 rounded-md border border-lime-200 bg-lime-50 px-3 py-1.5 text-xs font-medium text-lime-700 transition-colors hover:bg-lime-100"
        >
          <FileDown className="h-3.5 w-3.5" />
          Descargar acta{actaFileName ? ` (${actaFileName})` : ""}
        </a>
      )}
    </div>
  );
}
