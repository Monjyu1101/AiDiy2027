// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';

const VIDEOS = [
  { name: 'DrumRelaxes',                   id: 'vqTGZnakXII', dur: 12988 },
  { name: 'Zelda&Chill',                   id: 'GdzrrWA8e7A',  dur:  2445 },
  { name: 'J-POPオルゴールメドレー',        id: 'br107o3kGzk',  dur:  5994 },
  { name: 'J-POPジャズ',                   id: 'aJY04FKHvL8',  dur: 11657 },
  { name: 'J-POPピアノ1990',               id: 'Diz_VHiZLO4',  dur:  3616 },
  { name: 'J-POP名曲ピアノメドレー',        id: 'WehbO9hyDuY',  dur:  8153 },
  { name: 'Mr.Childrenピアノメドレー',      id: '3Q43_sD7GFs',  dur:  7410 },
  { name: 'YOASOBIピアノメドレー',          id: 'H89Y8obPh0U',  dur:  3645 },
  { name: 'あいみょんオルゴールメドレー',    id: 'jAxyOSxiA8E',  dur: 10433 },
  { name: 'アコースティックジャズ',          id: 'GBvnpowsPPg',  dur:  5746 },
  { name: 'アニソンピアノメドレー',          id: 'Ez-IcZ0Zb4E',  dur:  6997 },
  { name: 'アバター',                       id: 'n1g30VVQgS8',  dur:  3782 },
  { name: 'オフィスミュージックjazz',        id: 'tRO_TxWD33A',  dur:  8657 },
  { name: 'オフィスリラックスjazz',          id: 'MNwZ4WMxXYk',  dur: 12530 },
  { name: 'カーペンターズピアノメドレー',    id: 'IQg9NqO9EJE',  dur:  3157 },
  { name: 'クラシック人気曲メドレー',        id: 'jikKjpfnyE8',  dur: 20799 },
  { name: 'クラシック名曲集',               id: 'IKtM4D0wqF8',  dur:  5825 },
  { name: 'ケルト音楽集',                   id: 'CMqx8uw39ZI',  dur:  4548 },
  { name: 'サキソフォン',                   id: '6NHpv1XhqMQ',  dur:  8760 },
  { name: 'サザンオールスターズ',            id: 'w4gLVhajIWA',  dur: 12943 },
  { name: 'ジブリジャズ',                   id: '3jWRrafhO7M',  dur: 12724 },
  { name: 'ジブリソロギター',               id: 'FUqb11I8Mc8',  dur:  4310 },
  { name: 'ジブリピアノメドレー1',           id: 'YjohMzHkBqI',  dur:  6065 },
  { name: 'ショパンピアノ',                 id: '9Y5XmI8KiUc',  dur:  8738 },
  { name: 'スターバックスBGM',              id: 'myuCPpgJ_fs',  dur: 11520 },
  { name: 'ディズニーギター',               id: '5fMzH603jzI',  dur:  3713 },
  { name: 'ビートルズギター',               id: 'S4aZWW_H2PQ',  dur:  3694 },
  { name: 'ビートルズピアノ',               id: 'OWdKwn6LMr8',  dur:  3782 },
  { name: 'ヴァイオリン名曲集',             id: 'kPJ3no5VXSY',  dur:  7433 },
  { name: 'モーニングヒーリング',            id: 'AJxMeTUWEq0',  dur:  3366 },
  { name: 'リチャードクレイダーマンピアノ名曲集', id: 'YUuWYaBIsSI', dur: 3723 },
  { name: 'ルパンcafe',                    id: 'UwGtKExkgTs',  dur:  3104 },
  { name: 'ルパンjazz',                    id: 'YnKXa5CTug4',  dur: 13038 },
  { name: '桜小道',                         id: 'rs8UXhERAoE',  dur: 11013 },
  { name: '君の名は。サントラ',             id: 'twV43MJi_fg',  dur:  4842 },
  { name: '最弱テイマー',                   id: 'GgilfM6JnsE',  dur: 14537 },
];
