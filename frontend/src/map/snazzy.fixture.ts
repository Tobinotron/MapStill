import type { GoogleRule } from "./google-style";

// the rules of a real Snazzy Maps style that matter here
export const SNAZZY: GoogleRule[] = [
  { featureType: "all", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "landscape", elementType: "all", stylers: [{ color: "#f2f2f2" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#562135" }] },
  { featureType: "landscape.man_made", elementType: "geometry", stylers: [{ color: "#3d0a24" }] },
  { featureType: "road", elementType: "all", stylers: [{ saturation: -100 }, { lightness: 45 }] },
  { featureType: "road", elementType: "geometry", stylers: [{ visibility: "simplified" }, { color: "#682145" }] },
  { featureType: "road.local", elementType: "geometry", stylers: [{ visibility: "simplified" }, { color: "#55223c" }] },
  { featureType: "transit", elementType: "all", stylers: [{ visibility: "off" }] },
  { featureType: "transit.line", elementType: "geometry", stylers: [{ visibility: "simplified" }, { color: "#d3055c" }] },
  { featureType: "water", elementType: "all", stylers: [{ visibility: "off" }, { color: "#46bcec" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ visibility: "on" }, { color: "#e9b1cd" }] },
];
