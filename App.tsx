import React, { useEffect, useState } from "react";
import { Alert, Button, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { Outbox, Pending } from "./src/outbox";
import { endpoint, submit } from "./src/api";

const queue = new Outbox({
  read: () => AsyncStorage.getItem("field-readings-v1"),
  write: value => AsyncStorage.setItem("field-readings-v1", value),
});

export default function App() {
  const [origin, setOrigin] = useState("http://10.0.2.2:5079");
  const [token, setToken] = useState("");
  const [meter, setMeter] = useState("MTR-001");
  const [value, setValue] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [status, setStatus] = useState("Save readings offline, then sync when connected.");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all([queue.list(), SecureStore.getItemAsync("meter-writer-key")])
      .then(([entries, saved]) => { setPending(entries); if (saved) setToken(saved); })
      .catch(() => setStatus("Saved readings could not be loaded. Review local storage before proceeding."));
  }, []);

  async function action(work: () => Promise<void>) {
    setBusy(true);
    try { await work(); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Operation failed."); }
    finally {
      try { setPending(await queue.list()); }
      catch { setStatus("Unable to read saved outbox."); }
      setBusy(false);
    }
  }

  return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <Text style={styles.heading}>Field Meter Sync</Text>
    <Text>API origin</Text>
    <TextInput accessibilityLabel="API origin" style={styles.input} value={origin} onChangeText={setOrigin}
      autoCapitalize="none" autoCorrect={false} editable={!busy} />
    <Text>Writer key</Text>
    <TextInput accessibilityLabel="Writer key" style={styles.input} value={token} onChangeText={setToken}
      secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!busy} />
    <Button title="Save connection key" disabled={busy} onPress={() => void action(async () => {
      endpoint(origin);
      if (token.length < 32) throw new Error("Key must contain at least 32 characters.");
      await SecureStore.setItemAsync("meter-writer-key", token);
      setStatus("Writer key saved in device secure storage.");
    })} />
    <Text style={styles.section}>Record a cumulative reading</Text>
    <Text>Meter ID</Text>
    <TextInput accessibilityLabel="Meter ID" style={styles.input} value={meter} onChangeText={setMeter}
      autoCapitalize="characters" editable={!busy} />
    <Text>Reading in Wh</Text>
    <TextInput accessibilityLabel="Reading in Wh" style={styles.input} value={value} onChangeText={setValue}
      keyboardType="numeric" editable={!busy} />
    <Button title="Save offline" disabled={busy} onPress={() => void action(async () => {
      if (!/^[0-9]+$/.test(value)) throw new Error("Enter a whole-number reading.");
      await queue.enqueue({ operationId: Crypto.randomUUID(), meterId: meter, valueWh: Number(value) });
      setValue("");
      setStatus("Reading saved locally.");
    })} />
    <View style={styles.gap} />
    <Button title="Sync pending readings" disabled={busy} onPress={() => void action(async () => {
      const result = await queue.sync(reading => submit(origin, token, reading));
      setStatus(result.sent + " sent, " + result.blocked + " blocked, " + result.remaining + " retained.");
    })} />
    <Text accessibilityLiveRegion="polite" style={styles.status}>{busy ? "Working…" : status}</Text>
    <Text style={styles.section}>Saved readings ({pending.length})</Text>
    {pending.map(entry => <View key={entry.operationId} style={styles.card}>
      <Text>{entry.meterId} · {entry.valueWh} Wh</Text>
      <Text>{entry.blockedReason ?? "Pending synchronization"}</Text>
      {entry.blockedReason && <Button title="Review and discard" disabled={busy} onPress={() =>
        Alert.alert("Discard blocked reading?", "Confirm that you have reviewed and recorded the rejected value.", [
          { text: "Cancel", style: "cancel" },
          { text: "Discard", style: "destructive", onPress: () => void action(async () => {
            await queue.discard(entry.operationId);
            setStatus("Blocked reading discarded after review.");
          }) },
        ])} />}
    </View>)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { padding: 24, paddingTop: 60, backgroundColor: "#f3f6fa", flexGrow: 1, gap: 8 },
  heading: { fontSize: 28, fontWeight: "700", color: "#17314f", marginBottom: 12 },
  section: { fontSize: 18, fontWeight: "600", marginTop: 18 },
  input: { backgroundColor: "white", borderWidth: 1, borderColor: "#a5b4c7", borderRadius: 6, padding: 12, color: "#172538" },
  status: { paddingVertical: 12, color: "#17314f" },
  card: { backgroundColor: "white", padding: 14, borderRadius: 6, gap: 6 },
  gap: { height: 8 },
});
