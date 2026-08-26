/** Official BOT Chain ecosystem marks, taken verbatim from the explorer
 *  (`scan.botchain.ai`) and the token metadata its API returns. The BOT
 *  Chain wordmark ships white-on-dark, so its white strokes are swapped to
 *  `currentColor` to read on both Nyx surfaces; the brand green is untouched.
 *  A circular, low-opacity outline seats the round token marks without
 *  boxing them in ink. */

const MARKUP = {
  wbot:
    "<rect width=\"16\" height=\"16\" rx=\"8\" fill=\"#10A37F\"/> <path d=\"M6.5918 3.00057L11.2781 5.66503V7.61119C10.8127 7.82311 10.3657 8.08547 9.92456 8.34411C9.84403 8.39154 9.73943 8.33465 9.7741 8.49356L11.2733 9.30701L11.3407 11.1516L8.14405 13L5 11.2605V9.3659L9.69845 12.094V10.3129L6.59122 8.53182V6.63725L9.69845 8.3805V6.75131C9.69845 6.72924 9.80678 6.66562 9.70418 6.60157L6.59122 4.78108V3L6.5918 3.00057Z\" fill=\"white\"/>",
  usdt:
    "<path d=\"M1000,0c552.26,0,1000,447.74,1000,1000S1552.24,2000,1000,2000,0,1552.38,0,1000,447.68,0,1000,0\" fill=\"#53ae94\"/><path d=\"M1123.42,866.76V718H1463.6V491.34H537.28V718H877.5V866.64C601,879.34,393.1,934.1,393.1,999.7s208,120.36,484.4,133.14v476.5h246V1132.8c276-12.74,483.48-67.46,483.48-133s-207.48-120.26-483.48-133m0,225.64v-0.12c-6.94.44-42.6,2.58-122,2.58-63.48,0-108.14-1.8-123.88-2.62v0.2C633.34,1081.66,451,1039.12,451,988.22S633.36,894.84,877.62,884V1050.1c16,1.1,61.76,3.8,124.92,3.8,75.86,0,114-3.16,121-3.8V884c243.8,10.86,425.72,53.44,425.72,104.16s-182,93.32-425.72,104.18\" fill=\"#fff\"/>",
  botchain:
    "<path fill=\"currentColor\" d=\"M60.078 12.035h12.504v2.779h-4.574v12.184H64.63V14.814h-4.553z\"/><path fill=\"#10A37F\" d=\"M51.717 11.82q1.71 0 3.163.577a7.7 7.7 0 0 1 2.565 1.625 7.4 7.4 0 0 1 1.688 2.437q.62 1.389.62 3.035a7.5 7.5 0 0 1-.62 3.035 7.6 7.6 0 0 1-1.688 2.48 8 8 0 0 1-2.565 1.645q-1.454.577-3.163.577a8.7 8.7 0 0 1-3.185-.577 8.1 8.1 0 0 1-2.544-1.646 7.9 7.9 0 0 1-1.71-2.48 7.7 7.7 0 0 1-.598-3.034q0-1.647.598-3.035a7.4 7.4 0 0 1 1.71-2.437 7.8 7.8 0 0 1 2.544-1.625q1.475-.577 3.185-.577m.042 2.843q-.94 0-1.795.364a4.6 4.6 0 0 0-1.475 1.025 5.1 5.1 0 0 0-.983 1.54 4.9 4.9 0 0 0-.364 1.902q0 1.026.364 1.923a5.1 5.1 0 0 0 1.004 1.56q.642.664 1.475 1.048a4.4 4.4 0 0 0 1.774.364q.941 0 1.753-.364a4.6 4.6 0 0 0 1.453-1.047q.62-.685.962-1.56.363-.899.364-1.924a4.9 4.9 0 0 0-.364-1.903 4.8 4.8 0 0 0-.962-1.539 4.35 4.35 0 0 0-1.453-1.025 4.2 4.2 0 0 0-1.753-.364\"/><path fill=\"currentColor\" d=\"M35.734 11.918q1.646 0 2.843.449t1.838 1.304q.663.833.663 1.987 0 1.219-.705 2.117-.685.876-1.881 1.175 1.453.278 2.287 1.304.833 1.004.833 2.48 0 1.281-.705 2.222-.684.92-1.945 1.432-1.261.492-2.993.492h-7.117V11.918zm-.17 6.049q.94 0 1.495-.449.556-.47.556-1.283 0-.79-.556-1.218-.555-.448-1.496-.427H32.23v3.377zm0 6.241q1.196 0 1.88-.491.684-.492.684-1.39 0-.833-.684-1.325t-1.88-.47h-3.335v3.676z\"/><path fill=\"#10A37F\" d=\"m8.23 3.263 12.496 7.105v5.19c-1.241.565-2.433 1.265-3.61 1.955-.214.126-.493-.026-.4.398l3.997 2.17.18 4.918-8.525 4.93-8.384-4.64v-5.052l12.53 7.275v-4.75l-8.286-4.749v-5.052l8.286 4.649v-4.345c0-.059.288-.228.015-.4L8.228 8.012v-4.75z\"/>",
};


export function WbotMark({ size = 20 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="token-mark inline-block shrink-0"
    >
      <svg viewBox="0 0 16 16" width="100%" height="100%" dangerouslySetInnerHTML={{ __html: MARKUP.wbot }} />
    </span>
  );
}

export function UsdtMark({ size = 20 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="token-mark inline-block shrink-0"
    >
      <svg viewBox="0 0 2000 2000" width="100%" height="100%" dangerouslySetInnerHTML={{ __html: MARKUP.usdt }} />
    </span>
  );
}

export function BotChainMark({ height = 17 }: { height?: number }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 74 32"
      style={{ height, width: height * (74 / 32) }}
      className="shrink-0 text-text"
      dangerouslySetInnerHTML={{ __html: MARKUP.botchain }}
    />
  );
}
