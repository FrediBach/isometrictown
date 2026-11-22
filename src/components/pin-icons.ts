import { ChurchIcon, FlameIcon, Grid2x2Icon, HospitalIcon, LandmarkIcon, RefreshCcwIcon, SchoolIcon, SproutIcon, TreePineIcon, TreesIcon, WavesIcon, WheatIcon } from 'lucide-react';
import type { PinKindId } from '../image-pins';

/** The symbol each kind of pin shows in the panel and over the preview. */
export const PIN_ICONS: Record<PinKindId, typeof ChurchIcon> = {
  worship: ChurchIcon,
  townhall: LandmarkIcon,
  school: SchoolIcon,
  hospital: HospitalIcon,
  fire: FlameIcon,
  roundabout: RefreshCcwIcon,
  park: TreesIcon,
  wood: TreePineIcon,
  water: WavesIcon,
  square: Grid2x2Icon,
  field: WheatIcon,
  allotments: SproutIcon,
};
