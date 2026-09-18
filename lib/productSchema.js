// Real BCS attribute names for the "Products" category, taken verbatim from a
// live export of an existing product in that category (itemswww.csv,
// 2026-09-18 - a Still RX60-80 forklift). This is NOT the same schema as
// items.csv (that file uses different, more readable field names -
// battery_voltage_v/ah, capacity/t, front_tires, options, series... - none of
// which exist as real Attribute records under this category in BCS, which is
// why they never showed up as selectable in BCS's import column-mapping UI).
// Using these exact header names means BCS's own column-mapping dropdown can
// actually auto-recognize the columns/tags this tool produces, since the
// underlying Attribute records already exist under those names.
const PRODUCT_ATTRIBUTES = [
  'Id', 'ExternalId', 'Name', 'addeqbits', 'addequip', 'allwheel', 'armbroad',
  'armlength', 'armsize', 'attachbit', 'attachments', 'available', 'balancepoint',
  'basketload', 'battery', 'batterytype', 'brushpressure', 'buildbroad', 'capacity',
  'carrbroad', 'chassisno', 'cleaningwidth', 'closedheight', 'custprice',
  'dailyrentprice', 'dealerprice', 'engine', 'enginetype', 'forkcarr', 'forklength',
  'forks', 'freelift', 'frontend', 'has_image', 'height', 'hours', 'hours_9p',
  'internalno', 'intprice', 'isoclass', 'latrange', 'length', 'liftingheight',
  'loadcenter', 'loccity', 'loccountry', 'locpostcode', 'manufacturer', 'masttype',
  'model', 'monthlyrentpr', 'optcond', 'platfeedmot', 'rangefrom', 'rangeto',
  'remarks', 'rental', 'suctionwidth', 'techcond', 'techdescr', 'toc',
  'transmission', 'type', 'type_text', 'tyres', 'tyres2', 'tyresfront', 'tyresrear',
  'userremarks', 'viewhp', 'warranty', 'weeklyrentpr', 'weight', 'width',
  'workheight', 'yoc', 'yturl', 'ImportId', 'CreatedAt', 'UpdatedAt',
];

module.exports = { PRODUCT_ATTRIBUTES };
