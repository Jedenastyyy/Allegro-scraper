# 🛒 Allegro Scraper

Wtyczka do przeglądarki Microsoft Edge (Chromium) umożliwiająca scrapowanie list produktów z Allegro i eksport danych do pliku XLSX z filtrami.

---

## 📋 Spis treści

- [Wymagania](#wymagania)
- [Instalacja](#instalacja)
- [Pierwsze uruchomienie](#pierwsze-uruchomienie)
- [Używanie wtyczki](#używanie-wtyczki)
- [Zarządzanie dostępem](#zarządzanie-dostępem)
- [Eksport XLSX](#eksport-xlsx)
- [Kolumny w pliku XLSX](#kolumny-w-pliku-xlsx)
- [Rozwiązywanie problemów](#rozwiązywanie-problemów)

---

## Wymagania

- Microsoft Edge (wersja 88+) lub dowolna przeglądarka oparta na Chromium (Chrome, Brave itp.)
- Dostęp do internetu
- Konto GitHub (tylko dla właściciela wtyczki)

---

## Instalacja

1. Pobierz i rozpakuj archiwum ZIP z wtyczką
2. Otwórz Edge i przejdź do `edge://extensions/`
3. Włącz **Tryb dewelopera** (przełącznik w prawym górnym rogu)
4. Kliknij **Załaduj rozpakowany** i wskaż folder z wtyczką
5. Wtyczka pojawi się na pasku narzędzi przeglądarki

> ⚠️ Nie usuwaj ani nie przenoś folderu z wtyczką po instalacji — Edge musi mieć do niego stały dostęp.

---

## Pierwsze uruchomienie

Po instalacji wtyczka wyświetli ekran logowania. Wpisz hasło otrzymane od właściciela i kliknij **Zaloguj**.

> Sesja logowania jest zapamiętywana do momentu zamknięcia przeglądarki. Po ponownym uruchomieniu Edge trzeba zalogować się ponownie.

---

## Używanie wtyczki

### 1. Otwórz listę produktów na Allegro

Przejdź na Allegro i wyfiltruj produkty które chcesz zebrać (kategoria, fraza, filtry). Wtyczka scrapuje stronę która jest aktualnie otwarta.

### 2. Wybierz kontener scrapowania (opcjonalnie, lecz zalecane)

Domyślnie wtyczka przeszukuje całą stronę. Jeśli chcesz ograniczyć scrapowanie do konkretnego obszaru:

1. Kliknij **Wybierz** przy sekcji *Kontener scrapowania*
2. Najedź kursorem na element — podświetli się na niebiesko
3. Kliknij wybrany element — zostanie zaznaczony na pomarańczowo

### 3. Skonfiguruj paginację

| Opcja | Opis |
|-------|------|
| **Infinite scroll** | Przewija stronę w dół zamiast klikać "Następna strona" |
| **Selektor CSS** | Domyślnie `a[data-role="next-page"]` — działa na większości stron Allegro |
| **Wybierz (przycisk "Następna strona")** | Kliknij 5x w logo żeby wybrać przycisk ręcznie na stronie |
| **Min/Max delay** | Losowy czas oczekiwania między stronami (w milisekundach) |

> Zalecany delay: **800–2000 ms**. Zbyt niski może skutkować blokadą przez Allegro.

### 4. Uruchom scrapowanie

| Przycisk | Działanie |
|----------|-----------|
| **▶ Start** | Wznawia / kontynuuje scrapowanie (dołącza do istniejących danych) |
| **⟳ Nowe** | Czyści zebrane dane i zaczyna od nowa |
| **■ Stop** | Zatrzymuje scrapowanie w dowolnym momencie |

### 5. Podgląd danych

Panel **👁 Podgląd danych** pokazuje ostatnie 15 zebranych produktów na bieżąco podczas scrapowania.

---

## Eksport XLSX

Kliknij **⬇ Eksportuj XLSX** — plik zostanie automatycznie pobrany na Twój komputer.

Plik zawiera:
- Tabelę z filtrami na każdej kolumnie
- Zamrożony nagłówek (przewijanie bez utraty nazw kolumn)
- Automatycznie dobrane szerokości kolumn
- Numeryczne wartości jako liczby (możliwe sortowanie)

---

## Kolumny w pliku XLSX

| # | Kolumna | Typ | Opis |
|---|---------|-----|------|
| 1 | Nazwa produktu | tekst | Pełna nazwa oferty |
| 2 | Link do produktu | tekst | Bezpośredni URL oferty |
| 3 | ID oferty | liczba | Unikalny identyfikator (z URL-a) |
| 4 | Cena (PLN) | liczba | Cena w złotych |
| 5 | Ocena produktu | liczba | Ocena w skali 0–5 |
| 6 | Liczba kupujących | liczba | Ile osób kupiło ostatnio |
| 7 | Promowane | tak/nie | Czy oferta jest sponsorowana |
| 8 | Smart monety | tak/nie | Czy oferuje Smart! Monety |
| 9 | Smart | tak/nie | Czy objęta Allegro Smart! |
| 10 | Raty | tak/nie | Czy dostępne raty |
| 11 | Darmowa dostawa | tak/nie | Czy dostawa gratis |
| 12 | Czas dostawy (dni) | liczba | Liczba dni do dostawy |
| 13 | Gwarancja najniższej ceny | tak/nie | Badge gwarancji ceny |
| 14 | Czy parametry są wpisane | tak/nie | Czy oferta ma uzupełnione parametry |
| 15+ | Parametry dynamiczne | tekst | Jedna kolumna na każdy unikalny parametr (np. Marka, Kolor, Rozmiar) |

---

## Rozwiązywanie problemów


**„Hasło nie zostało jeszcze ustawione"**
Właściciel musi zalogować się do panelu admina i ustawić hasło (krok 4 w konfiguracji).

**„Nie znaleziono produktów"**
Upewnij się że jesteś na stronie listy produktów Allegro (nie na stronie konkretnej oferty). Spróbuj zresetować kontener scrapowania (przycisk ✕ przy konterze).

**Wtyczka scrapuje w kółko te same strony**
Upewnij się że przycisk „Następna strona" jest poprawnie wykryty. Możesz wskazać go ręcznie przez tryb wyboru elementu.

**Plik XLSX jest pusty po otwarciu**
Upewnij się że używasz aktualnej wersji wtyczki. Starsza wersja mogła generować nieprawidłowy plik.

---

## Licencja

MIT © 2025

---

## Jedenastyyy
Kocham vibecodować essa.
Stworzone z pomocą [Claude](https://claude.ai) by Anthropic.
