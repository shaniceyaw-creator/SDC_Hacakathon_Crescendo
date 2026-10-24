# EventOps v2 Dataset — Data Dictionary

Synthetic data for a small event company based in **Petaling Jaya, Selangor**
(own crew and equipment, hires extra rentals/freelancers when needed).
300 completed events, 1 Oct 2023 – 30 Sep 2026. Annual sales ≈ RM 1.4–1.8 million
(a Malaysian small enterprise). Companies and people are fictional.

## events_2023_2026.csv (one row per event)

| Column | Meaning |
|---|---|
| Event_ID | EV-0001 … in date order |
| Event_Name | Readable name |
| Client_ID, Client_Type | Link to clients.csv; Corporate or Individual |
| Company_Name | Blank for individuals |
| Client_Name | Contact person |
| Repeat_Client | Yes if this client booked before this event |
| Event_Type | 9 types (annual dinner, seminar, launch, wedding, party, open house, family day, fun run, exhibition) |
| Event_Date, Day_Of_Week, Month, Year, Is_Weekend | When |
| Start_Time, End_Time, Start_Hour, Duration_Hours | Event hours (excluding setup) |
| Peak_Period, Is_Peak | Festive/busy period label from peak_periods.csv |
| Venue_Name, Venue_Type, Venue_Setting | Venue (fictional name), type, Indoor/Outdoor |
| Venue_Area, Venue_State, Venue_Latitude, Venue_Longitude | Real town near KL/Selangor |
| Distance_From_PJ_KM | Approximate road distance from the PJ office |
| Guest_Count | 30–2,000 |
| Seating_Style | Banquet, Theatre, Classroom, Cocktail, Picnic, Open Space, Booths |
| Service_Level | Basic, Standard, Premium |
| Open_To_Public | Yes if the public could attend / buy tickets |
| Special_Request | Customer's special request ("None" if none) |
| Event_Coordinators, AV_Technicians, Logistics_Crew, Safety_Officers, Total_Crew | Crew used |
| Chairs, Tables, Canopy_Tents, Sound_Systems, Stage_Platforms, LED_Screens | Equipment used |
| Rented_Units | Units hired because owned stock was not enough |
| Crew_Hours_Each | Event + setup + teardown + travel hours |
| Labour_Cost_RM … Insurance_Admin_RM | Cost breakdown |
| Total_Cost_RM | Total direct cost of the event |
| Selling_Price_RM | Price charged to the client |
| Profit_RM, Margin_Pct | Price − cost |
| Status | Completed |
| Data_Split | train (≤ Oct 2025), validation (Nov 2025 – Mar 2026), test (Apr – Sep 2026) |

## clients.csv
Client_ID, Client_Type, Company_Name, Contact_Name, Industry, Home_Area, Bookings,
First_Event, Last_Event, Usual_Event_Type, Usual_Month,
Booking_Pattern (Annual / Frequent / Occasional / One-off), Usual_Request, Total_Spent_RM.

## Other files
- **venue_areas.csv** — area, state, coordinates, distance from the PJ office.
- **peak_periods.csv** — festive and busy periods 2023–2027 (approximate dates).
- **company_profile.json** — office location, owned equipment, crew hourly rates.
- **model_schema.json** — model inputs/outputs used by the notebook and website.
