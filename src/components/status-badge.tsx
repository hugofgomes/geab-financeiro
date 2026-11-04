import { Badge } from "@/components/ui/badge"
import { STATUS_LABEL, type DisplayStatus } from "@/lib/types"
import { cn } from "@/lib/utils"

const STYLE: Record<DisplayStatus, string> = {
  pago: "border-green-600/30 bg-green-600/10 text-green-800",
  pendente: "border-slate-400/40 bg-slate-100 text-slate-700",
  parcial: "border-amber-500/40 bg-amber-100 text-amber-900",
  atrasado: "border-red-600/30 bg-red-100 text-red-800",
  em_conferencia: "border-blue-600/30 bg-blue-100 text-blue-800",
}

export function StatusBadge({ status }: { status: DisplayStatus }) {
  return (
    <Badge variant="outline" className={cn("font-medium", STYLE[status])}>
      {STATUS_LABEL[status]}
    </Badge>
  )
}
