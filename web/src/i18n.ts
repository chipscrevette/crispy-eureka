/** The site speaks French by default and English on request; index.html sets <html lang> before the first paint. */
export type Lang = 'fr' | 'en'

export const lang = (): Lang => (document.documentElement.lang === 'en' ? 'en' : 'fr')

/** The French text, or the English one when the visitor chose English. */
export const tr = (fr: string, en: string) => (lang() === 'en' ? en : fr)

export const locale = () => (lang() === 'en' ? 'en-GB' : 'fr-FR')

/** A number in the visitor's language: 2,4 in French, 2.4 in English. */
export const fmt = (v: number, digits = 0) =>
  v.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** Every text on the page follows the language, so a switch reloads the page, like the theme. */
export function switchLang() {
  try {
    localStorage.setItem('adresse-lang', lang() === 'en' ? 'fr' : 'en')
  } catch {
    return
  }
  window.location.reload()
}

/** French names and descriptions of the pipeline's layers (web/public/data carries the English ones). */
const FEATURES_FR: Record<string, [string, string]> = {
  hotels_r1: ["Hôtels", "Hôtels et hébergements dans le bloc et ses six voisins (environ 350 m autour)"],
  dining_r1: ["Restaurants et cafés", "Restaurants, cafés et bars dans le bloc et ses six voisins (environ 350 m autour)"],
  culture_r1: ["Culture", "Galeries, musées, monuments et salles dans le bloc et ses six voisins (environ 350 m autour)"],
  fashion_stores_r1: ["Boutiques de mode", "Toutes les boutiques de mode et de prêt-à-porter dans le bloc et ses six voisins (environ 350 m autour)"],
  beauty_stores_r1: ["Boutiques de beauté", "Toutes les boutiques de beauté et de soins dans le bloc et ses six voisins (environ 350 m autour)"],
  mass_market_r1: ["Grande consommation", "Restauration rapide et supérettes dans le bloc et ses six voisins (environ 350 m autour)"],
  offices_r1: ["Bureaux", "Sièges d’entreprises et services financiers dans le bloc et ses six voisins (environ 350 m autour)"],
  'luxury_jewellery-watches_r1': ["Boutiques de luxe (joaillerie-horlogerie)", "Boutiques du catalogue, profil joaillerie-horlogerie, dans le bloc et ses six voisins (environ 350 m autour)"],
  'luxury_fashion-house_r1': ["Boutiques de luxe (maisons de mode)", "Boutiques du catalogue, profil maisons de mode, dans le bloc et ses six voisins (environ 350 m autour)"],
  luxury_beauty_r1: ["Boutiques de luxe (beauté)", "Boutiques du catalogue, profil beauté, dans le bloc et ses six voisins (environ 350 m autour)"],
  luxury_neighbours_r1: ["Luxe voisin", "Boutiques de luxe du catalogue, tous profils, dans les six blocs voisins"],
  population_r1: ["Habitants", "Habitants dans le bloc et ses six voisins (environ 350 m autour)"],
  living_standard_r1: ["Niveau de vie", "Revenu disponible moyen par unité de consommation des habitants dans le bloc et ses six voisins (environ 350 m autour)"],
  owners_share_r1: ["Propriétaires", "Part des ménages propriétaires de leur logement dans le bloc et ses six voisins (environ 350 m autour)"],
  poverty_share_r1: ["Ménages pauvres", "Part des ménages sous le seuil de pauvreté dans le bloc et ses six voisins (environ 350 m autour)"],
  apartment_price_m2: ["Prix des appartements", "Prix de vente médian des appartements à environ 350 m (700 m là où les ventes sont rares)"],
  apartment_sales_r1: ["Ventes d’appartements", "Ventes d’appartements à l’unité dans le bloc et ses six voisins (environ 350 m autour)"],
  commercial_price_m2: ["Prix des locaux commerciaux", "Prix de vente médian des locaux commerciaux à environ 350 m (700 m là où ils sont rares)"],
  transit_entries_r2: ["Entrées en gare", "Entrées moyennes par jour dans les stations de métro, RER et train à environ 600 m"],
  commercial_sales_r1: ["Ventes de locaux commerciaux", "Ventes de locaux commerciaux dans le bloc et ses six voisins (environ 350 m autour)"],
  street_footfall: ["Passage piéton", "Passage estimé dans la rue la plus fréquentée du bloc : combien de trajets à pied de 800 m au plus l’empruntent, en multiple de la rue parisienne médiane"],
  upscale_rooms_r1: ["Chambres d’hôtels haut de gamme", "Chambres d’hôtels 4 et 5 étoiles dans le bloc et ses six voisins (environ 350 m autour)"],
  tourist_zone_r1: ["Zone touristique internationale", "Part du bloc et de ses six voisins en zone touristique internationale (ZTI), où les boutiques peuvent ouvrir le dimanche et en soirée"],
  vacant_shops_r1: ["Boutiques vides", "Locaux en rez-de-chaussée vides, sur rue ou en angle, dans le bloc et ses six voisins (environ 350 m autour)"],
  vacancy_r1: ["Part de vitrines vides", "Part des vitrines sur rue ou en angle qui sont vides, dans le bloc et ses six voisins (environ 350 m autour)"],
  large_vacant_r1: ["Grandes boutiques vides", "Vitrines vides de 300 m² ou plus, sur rue ou en angle, dans le bloc et ses six voisins (environ 350 m autour)"],
  demand: ["Pouvoir d’achat", "Revenus des habitants, actifs et visiteurs du bloc, un tiers chacun"],
  demand_residents: ["Revenus des habitants", "Revenus des habitants du bloc"],
  demand_workers: ["Actifs", "Personnes qui travaillent dans le bloc"],
  demand_visitors: ["Visiteurs", "Visiteurs du bloc"],
}

const UNITS_FR: Record<string, string> = {
  places: 'lieux',
  boutiques: 'boutiques',
  people: 'personnes',
  '€ / person / year': '€ / personne / an',
  sales: 'ventes',
  'entries / day': 'entrées / jour',
  '× median street': '× rue médiane',
  rooms: 'chambres',
  units: 'locaux',
  '(Paris average 100)': '(moyenne de Paris 100)',
}

export const featureLabel = (key: string, english: string) => (lang() === 'en' ? english : (FEATURES_FR[key]?.[0] ?? english))
export const unitLabel = (unit: string) => (lang() === 'en' ? unit : (UNITS_FR[unit] ?? unit))

/** The data files' layer list with French labels and descriptions when the page is in French. */
export function localFeatures<T extends { key: string; label: string; description: string }>(list: T[]): T[] {
  if (lang() === 'en') return list
  return list.map((f) => {
    const fr = FEATURES_FR[f.key]
    return fr ? { ...f, label: fr[0], description: fr[1] } : f
  })
}
