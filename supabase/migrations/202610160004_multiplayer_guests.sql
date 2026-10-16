-- Los invitados (sin cuenta) también se ven y leen el chat; escribir en el chat sigue
-- requiriendo cuenta (send_chat solo está habilitada para usuarios con sesión).
create policy "vallecito posiciones: invitados leen" on realtime.messages for select to anon
  using (realtime.topic() like 'vallecito:pos:%' and extension in ('broadcast', 'presence'));
create policy "vallecito posiciones: invitados escriben" on realtime.messages for insert to anon
  with check (realtime.topic() like 'vallecito:pos:%' and extension in ('broadcast', 'presence'));
create policy "vallecito chat: invitados leen" on realtime.messages for select to anon
  using (realtime.topic() like 'vallecito:chat:%' and extension = 'broadcast');
