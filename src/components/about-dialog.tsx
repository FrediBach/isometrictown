import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function AboutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(540px,calc(100vw-32px))] gap-0 overflow-hidden rounded-lg border border-input bg-background p-0 ring-0 sm:max-w-[540px]">
        <DialogHeader className="flex-row items-center gap-3 border-b border-input bg-card px-6 py-4 text-left">
          <img src="/logo.svg" alt="" width={36} height={36} />
          <div>
            <DialogTitle className="text-lg leading-tight font-semibold tracking-[-0.02em]">Isometric Town</DialogTitle>
            <DialogDescription className="micro mt-1 text-[10.5px] text-muted-foreground">About this tool</DialogDescription>
          </div>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-6 pt-5 pb-5 text-sm leading-relaxed text-pretty">
          <p className="m-0 text-[15px] leading-normal">
            Isometric Town draws any town in isometric 3D as clean linework for pen plotters. Pick a place, frame it, and download an SVG with one layer per pen, ready for an AxiDraw,
            Inkscape or vpype.
          </p>
          <p className="m-0 text-muted-foreground">
            Buildings, streets, water and parks come from OpenStreetMap. Building heights come from the map data where it has them. Roof shapes come from OpenStreetMap where they're
            tagged. Elsewhere they're worked out from each building's shape, its neighbours and the local building style. Trees, cars and lamps are made up, with a seed so the same
            settings always give the same drawing.
          </p>
          <p className="m-0 text-muted-foreground">Hidden lines are removed before you download, so nothing is drawn twice and nothing shows through a wall.</p>
        </div>
        <div className="flex items-end justify-between gap-6 border-t px-6 py-4 text-xs text-muted-foreground [&_a]:underline [&_a]:decoration-input [&_a]:underline-offset-2 hover:[&_a]:text-foreground">
          <p className="m-0 leading-relaxed">
            Map data ©{' '}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">
              OpenStreetMap contributors
            </a>
            . Tiles by{' '}
            <a href="https://openfreemap.org" target="_blank" rel="noopener">
              OpenFreeMap
            </a>
            , schema ©{' '}
            <a href="https://www.openmaptiles.org" target="_blank" rel="noopener">
              OpenMapTiles
            </a>
            . Map view by{' '}
            <a href="https://maplibre.org" target="_blank" rel="noopener">
              MapLibre
            </a>
            .
          </p>
          <a className="readout shrink-0 text-[11px]" href="https://isometrictown.com">
            isometrictown.com
          </a>
        </div>
        <div className="border-t px-6 py-3 text-xs text-muted-foreground">
          <p className="readout m-0 text-[11px]">
            © {new Date().getFullYear()}{' '}
            <a className="underline decoration-input underline-offset-2 hover:text-foreground" href="https://fredibach.com" target="_blank" rel="noopener">
              Fredi Bach
            </a>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
