extends Node
# Effets sonores synthétisés au démarrage (sinus + enveloppe) : aucun fichier audio.

var bank := {}
var players: Array[AudioStreamPlayer] = []
var idx := 0
var muted := false


func _ready() -> void:
	for i in 8:
		var p := AudioStreamPlayer.new()
		p.volume_db = -8.0
		add_child(p)
		players.append(p)
	bank["move"] = _tone([300.0], 0.07, 0.30, 700.0, 30.0)
	bank["merge"] = _tone([440.0, 660.0], 0.16, 0.40, 300.0, 14.0)
	bank["big"] = _tone([330.0, 495.0, 660.0, 990.0], 0.45, 0.45, 0.0, 6.0)
	bank["eat"] = _tone([520.0, 780.0], 0.14, 0.40, 500.0, 16.0)
	bank["gold"] = _tone([660.0, 990.0, 1320.0], 0.30, 0.40, 0.0, 9.0)
	bank["die"] = _tone([180.0, 120.0], 0.55, 0.50, -150.0, 5.0)
	bank["reveal"] = _tone([620.0], 0.05, 0.22, 200.0, 40.0)
	bank["flag"] = _tone([880.0, 1100.0], 0.09, 0.30, 0.0, 22.0)
	bank["boom"] = _noise(0.5, 0.55, 7.0)
	bank["win"] = _tone([523.0, 659.0, 784.0, 1046.0], 0.8, 0.45, 0.0, 3.5)
	bank["click"] = _tone([900.0], 0.04, 0.20, 0.0, 60.0)


func play(sound: String) -> void:
	if muted or not bank.has(sound):
		return
	var p := players[idx]
	idx = (idx + 1) % players.size()
	p.stream = bank[sound]
	p.play()


func _tone(freqs: Array, dur: float, vol: float, slide: float, decay: float) -> AudioStreamWAV:
	var rate := 22050
	var n := int(rate * dur)
	var data := PackedByteArray()
	data.resize(n * 2)
	for i in n:
		var t := float(i) / rate
		var env := exp(-t * decay) * minf(1.0, t * 400.0)
		var s := 0.0
		for f in freqs:
			s += sin(TAU * (float(f) + slide * t) * t)
		s = s / freqs.size() * env * vol
		data.encode_s16(i * 2, int(clampf(s, -1.0, 1.0) * 32000.0))
	return _wav(data, rate)


func _noise(dur: float, vol: float, decay: float) -> AudioStreamWAV:
	var rate := 22050
	var n := int(rate * dur)
	var data := PackedByteArray()
	data.resize(n * 2)
	var r := RandomNumberGenerator.new()
	r.seed = 7
	var lp := 0.0
	for i in n:
		var t := float(i) / rate
		lp = lerpf(lp, r.randf_range(-1.0, 1.0), 0.25)
		data.encode_s16(i * 2, int(lp * exp(-t * decay) * vol * 32000.0))
	return _wav(data, rate)


func _wav(data: PackedByteArray, rate: int) -> AudioStreamWAV:
	var w := AudioStreamWAV.new()
	w.format = AudioStreamWAV.FORMAT_16_BITS
	w.mix_rate = rate
	w.stereo = false
	w.data = data
	return w
