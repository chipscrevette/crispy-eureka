from adresse_pipeline import hotels

HEADER = (
    "DATE DE CLASSEMENT;TYPOLOGIE ÉTABLISSEMENT;CLASSEMENT;CATÉGORIE;MENTION (villages de vacances);"
    "NOM COMMERCIAL;ADRESSE;CODE POSTAL;COMMUNE;SITE INTERNET;TYPE DE SÉJOUR;"
    "CAPACITÉ D'ACCUEIL (PERSONNES);NOMBRE DE CHAMBRES;NOMBRE D'EMPLACEMENTS;"
    "NOMBRE D'UNITES D'HABITATION (résidences de tourisme);NOMBRE DE LOGEMENTS (villages de vacances);"
    "classement prorogé"
)
# rows as the Atout France register writes them (October 2026 export)
ROWS = [
    "20/10/2021;HÔTEL DE TOURISME;4 étoiles;-;-;25HOURS HÔTEL TERMINUS NORD;12 boulevard de Denain;"
    "75010;PARIS 10E ARRONDISSEMENT;https://www.25hours-hotels.com/fr;-;489;237;-;-;-;oui",
    "23/12/2024;HÔTEL DE TOURISME;3 étoiles;-;-;9 HÔTEL BASTILLE LYON;23 rue de lyon;75012;PARIS;"
    "https://www.9-hotel-bastille-lyon.fr;-;88;48;-;-;-;non",
    "19/06/2023;HÔTEL DE TOURISME;3 étoiles;-;-;1924 HÔTEL;2 Rue Gabriel Péri;38000;GRENOBLE;"
    "https://www.1924hotel.com/;-;62;37;-;-;-;non",
    "01/01/2024;RÉSIDENCE DE TOURISME;4 étoiles;-;-;CITADINES;1 rue X;75015;PARIS;-;-;100;-;-;50;-;non",
    "01/01/2024;HÔTEL DE TOURISME;5 étoiles;-;-;FOUR SEASONS HÔTEL GEORGE V;31 Avenue George V;75008;"
    "PARIS 8E ARRONDISSEMENT;-;-;500;244;-;-;-;non",
]


def register(tmp_path):
    path = tmp_path / "hebergements_classes.csv"
    path.write_text("﻿" + "\n".join([HEADER, *ROWS]), encoding="utf-8")
    return hotels.read_register(path)


def test_only_paris_hotels_of_tourism_are_kept_with_stars_and_rooms(tmp_path):
    found = list(hotels.paris_hotels(register(tmp_path)))

    assert [(h.name, h.stars, h.rooms) for h in found] == [
        ("25HOURS HÔTEL TERMINUS NORD", 4, 237),
        ("9 HÔTEL BASTILLE LYON", 3, 48),
        ("FOUR SEASONS HÔTEL GEORGE V", 5, 244),
    ]


def test_unsure_or_outside_paris_matches_are_dropped():
    found = [
        hotels.ClassifiedHotel("A", "12 boulevard de Denain", "75010", 4, 237),
        hotels.ClassifiedHotel("B", "nowhere", "75010", 4, 10),
        hotels.ClassifiedHotel("C", "1 rue de Paris", "75008", 5, 20),
    ]
    answer = (
        "id,address,postcode,longitude,latitude,result_score,result_postcode,result_citycode\n"
        "0,12 boulevard de Denain,75010,2.354925,48.879649,0.97,75010,75110\n"
        "1,nowhere,75010,2.35,48.87,0.31,75010,75110\n"
        "2,1 rue de Paris,75008,2.44,48.85,0.9,94300,94080\n"
    )
    sent = []

    def fake_geocode(table):
        sent.append(table.decode())
        return answer

    placed = hotels.place(found, geocode=fake_geocode)

    assert [(p.hotel.name, p.lon, p.lat) for p in placed] == [("A", 2.354925, 48.879649)]
    assert sent[0].splitlines()[0] == "id,address,postcode"
