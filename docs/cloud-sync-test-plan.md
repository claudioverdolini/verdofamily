# VerdoFamily cloud sync acceptance test

1. Register the first account with email and password.
2. Create a family and optionally import the local device data.
3. Generate a one-use invite code from Users.
4. Register a second account on another browser/device and join with the code.
5. Add an item to Shopping on device A and verify it appears on device B after Realtime delivery.
6. Add/edit a calendar event on device B and verify it appears on device A.
7. Reload both devices and verify the shared family document persists.
8. Log out and back in to confirm Supabase session recovery and family membership lookup.

Cloud documents deliberately strip local profile passwords before saving.