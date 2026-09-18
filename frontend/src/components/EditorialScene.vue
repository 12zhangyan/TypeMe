<script setup lang="ts">
import { useId } from 'vue'
withDefaults(defineProps<{ scene?: 'hero' | 'jung' | 'bigfive' | 'reflection' | 'welcome' | 'companion' }>(), { scene: 'hero' })
const id = useId().replace(/:/g, '')
</script>
<template>
  <svg viewBox="0 0 640 600" fill="none" aria-hidden="true" class="editorial-scene">
    <defs>
      <linearGradient :id="id+'-sky'" x1="80" y1="20" x2="550" y2="580" gradientUnits="userSpaceOnUse"><stop stop-color="#E9EDD9"/><stop offset="1" stop-color="#F3DBC0"/></linearGradient>
      <linearGradient :id="id+'-water'" x1="330" y1="345" x2="330" y2="590" gradientUnits="userSpaceOnUse"><stop stop-color="#92AE9E"/><stop offset="1" stop-color="#D1DDD0"/></linearGradient>
      <clipPath :id="id+'-window'"><path d="M42 590V272C42 122 164 0 314 0S586 122 586 272V590Z" /></clipPath>
      <pattern :id="id+'-grain'" width="17" height="19" patternUnits="userSpaceOnUse"><circle cx="2" cy="4" r=".7" fill="#344E3D" opacity=".16"/><circle cx="12" cy="14" r=".5" fill="#FFFDF5" opacity=".6"/></pattern>
    </defs>
    <g :clip-path="`url(#${id}-window)`">
      <path d="M0 0H640V600H0Z" :fill="`url(#${id}-sky)`" />
      <circle cx="455" cy="144" r="66" fill="#E5B686"/><circle cx="455" cy="144" r="83" stroke="#FAF6E9" opacity=".7"/>
      <path d="M-40 336C88 244 175 313 284 280C400 247 487 260 665 207V600H0Z" fill="#C2CCA8"/>
      <path d="M-30 395C109 308 183 385 284 328C400 262 524 366 671 306V600H0Z" fill="#88A387"/>
      <path d="M-25 473C115 378 246 425 346 379C457 329 575 396 680 348V600H0Z" fill="#426D56"/>
      <path d="M407 365C324 382 354 416 302 438C260 456 147 469 171 499C199 537 379 526 332 600H541C546 510 365 512 358 481C351 455 442 425 459 409C478 391 423 381 456 365Z" :fill="`url(#${id}-water)`"/>
      <path d="M316 488H368M339 496H392M288 535H325M301 544H342" stroke="#EDF0DF" stroke-width="2" stroke-linecap="round"/>
      <template v-if="scene === 'hero' || scene === 'welcome' || scene === 'reflection'">
        <path d="M152 405V229C152 171 193 129 240 129S328 171 328 229V405H295V229C295 190 270 164 240 164S185 190 185 229V405Z" fill="#EAC3A1"/>
        <path d="M152 405V229C152 171 193 129 240 129" stroke="#FAE8D1" stroke-width="8"/>
        <path d="M181 405H295L306 422H169Z" fill="#F1D5B1"/><path d="M169 422H306V438H169Z" fill="#BE9372"/>
        <path d="M163 438H313L326 455H151Z" fill="#E7C7A2"/><path d="M151 455H326V470H151Z" fill="#AD8262"/>
        <path d="M146 470H333L346 487H134Z" fill="#E7C7A2"/>
        <g transform="translate(242 324)"><path d="M-16 55L-19 91M7 55L16 90" stroke="#253F34" stroke-width="11" stroke-linecap="round"/><path d="M-18 91H-30M15 91H25" stroke="#E8D8B9" stroke-width="6" stroke-linecap="round"/><path d="M-22 15Q-10 4 5 15L17 61H-25Z" fill="#F4EDD7"/><path d="M-20 22L-31 45M6 21L21 40" stroke="#F4EDD7" stroke-width="11" stroke-linecap="round"/><circle cx="-8" cy="-2" r="14" fill="#B9805E"/><path d="M-22-2Q-28-22-8-21Q10-22 7-1L-4-7-22-2" fill="#243E32"/><path d="M18 34L32 31L36 48L21 51Z" fill="#D59A65"/></g>
      </template>
      <template v-else-if="scene === 'jung'">
        <g transform="translate(90 145)"><path d="M0 255V95A68 68 0 0 1 136 95V255Z" fill="#E7BB99"/><path d="M23 255V96A45 45 0 0 1 113 96V255Z" fill="#57775E"/><path d="M161 255V42A60 60 0 0 1 281 42V255Z" fill="#F1D3A9"/><path d="M182 255V43A39 39 0 0 1 260 43V255Z" fill="#ABC0A4"/><path d="M304 255V119A59 59 0 0 1 422 119V255Z" fill="#B5C2A3"/><path d="M325 255V119A38 38 0 0 1 401 119V255Z" fill="#D9DEBB"/></g>
        <path d="M214 537L304 359L411 504L339 472Z" fill="#F6EAD0"/><path d="M304 359L339 472L214 537Z" fill="#D3B999"/>
      </template>
      <template v-else-if="scene === 'bigfive'">
        <g stroke="#244E38" stroke-width="6" stroke-linecap="round"><path d="M203 477L177 244M273 484L279 192M354 491L371 245M422 488L447 305M139 477L109 339"/></g>
        <g fill="#E7B895"><ellipse cx="173" cy="236" rx="42" ry="20" transform="rotate(-26 173 236)"/><ellipse cx="173" cy="236" rx="20" ry="42" transform="rotate(-26 173 236)"/></g>
        <g fill="#E4DAB0"><ellipse cx="279" cy="192" rx="49" ry="22"/><ellipse cx="279" cy="192" rx="22" ry="49"/></g>
        <g fill="#B9C9D0"><ellipse cx="371" cy="245" rx="48" ry="22" transform="rotate(25 371 245)"/><ellipse cx="371" cy="245" rx="22" ry="48" transform="rotate(25 371 245)"/></g>
        <g fill="#C5B5BA"><ellipse cx="447" cy="305" rx="35" ry="18"/><ellipse cx="447" cy="305" rx="18" ry="35"/></g>
        <g fill="#F4E7C7"><ellipse cx="109" cy="339" rx="34" ry="17"/><ellipse cx="109" cy="339" rx="17" ry="34"/></g>
        <path d="M157 389Q96 386 100 351Q160 350 157 389M269 346Q224 327 236 295Q285 314 269 346M373 408Q437 369 432 355Q372 355 373 408" fill="#9EB88C"/>
      </template>
      <template v-else><path d="M143 419Q209 356 321 389Q418 347 498 402V506Q396 477 321 520Q212 478 143 510Z" fill="#F0DFBE"/><path d="M321 389V520" stroke="#C3AB89" stroke-width="3"/><path d="M193 412L266 404M195 430L286 425M196 449L258 448M362 414L437 406M362 434L464 429" stroke="#A49D7A" stroke-width="4" stroke-linecap="round"/></template>
      <path d="M-18 617Q11 488 97 415Q84 553 38 599M605 620Q550 452 567 348Q636 419 640 590" fill="#254D39"/>
      <path d="M44 532Q-8 463 0 405Q60 435 64 504M575 477Q492 450 490 389Q566 391 584 453" fill="#315E45"/>
      <path d="M43 582Q108 488 149 495Q138 561 43 599M592 547Q530 508 490 517Q512 576 608 589" fill="#638A61"/>
      <path d="M0 0H640V600H0Z" :fill="`url(#${id}-grain)`"/>
    </g>
    <path d="M42 590V272C42 122 164 0 314 0S586 122 586 272V590" stroke="#F6F3E8" stroke-width="2"/>
    <path d="M81 178L96 169L88 185M502 80L514 68L509 86" stroke="#6F8069" stroke-width="2" stroke-linecap="round"/>
  </svg>
</template>
<style scoped>.editorial-scene { display: block; width: 100%; height: 100%; object-fit: contain; }</style>
