import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRoom, splitRooms, teacherDisplayName, groupName, currentParity,
  activeForWeek, scheduleForWeek, allRooms, availableRooms, roomLessons
} from '../data-model.mjs';

const sample = {
  groupLessons: [
    {id:1, day:5, pair:3, typeWeek:null,groupId:61,subject:'Информатика',teacher:'Купряков Е.И.',room:' 2 К-309'},
    {id:2, day:5, pair:3, typeWeek:0,groupId:52,subject:'Русский язык',teacher:'А.Б.',room:'1К-413'},
    {id:3, day:5, pair:3, typeWeek:1,groupId:52,subject:'История',teacher:'В.Г.',room:'1К-413'},
    {id:4, day:5, pair:4, typeWeek:null,groupId:52,subject:'Иностранный язык',teacher:'А.Б. // В.Г.',room:'2К-305//1 К-413'},
    {id:5, day:2, pair:1, typeWeek:null,groupId:53,subject:'',teacher:'',room:'1К-404'}
  ]
};

test('rooms normalize spacing, корпус letter case, and composite fields', () => {
  assert.equal(normalizeRoom(' 2 К-309 '), '2К-309');
  assert.deepEqual(splitRooms('2К-305//1 К-413//2 К-305'), ['2К-305','1К-413']);
});

test('weekly alternatives do not overlap, permanent lessons do', () => {
  assert.equal(activeForWeek({typeWeek:null},0), true);
  assert.equal(activeForWeek({typeWeek:null},1), true);
  assert.equal(activeForWeek({typeWeek:0},1), false);
  assert.equal(activeForWeek({typeWeek:1},0), false);
  assert.equal(scheduleForWeek(sample.groupLessons,0).length,3);
  assert.equal(scheduleForWeek(sample.groupLessons,1).length,3);
});

test('free room search respects day, pair, parity and active timetable', () => {
  assert.deepEqual(allRooms(sample),['1К-413','2К-305','2К-309']);
  assert.deepEqual(availableRooms(sample,{day:5,pair:3,parity:0}),['2К-305']);
  assert.deepEqual(availableRooms(sample,{day:5,pair:4,parity:1}),['2К-309']);
  assert.equal(roomLessons(sample,'2К-309',1).length,1);
  assert.equal(roomLessons(sample,'2 К-309',1)[0].groupId,61);
});

test('teacher index is preserved and display name gets initials', () => {
  assert.equal(teacherDisplayName('КупряковЕИ'),'Купряков Е.И.');
  assert.equal(teacherDisplayName('Купряков Е.И.'),'Купряков Е.И.');
});

test('group label follows academic year', () => {
  assert.equal(groupName({id:54,course:2,shortName:'ТИТО'},2026,11),'2ТИТО-25');
  assert.equal(groupName({id:54,course:2,shortName:'ТИТО'},2027,5),'2ТИТО-25');
});

test('known parity toggles across Mondays', () => {
  const data = {parityWeek:'четная',generatedAt:'2026-11-18T05:00:00Z'};
  assert.equal(currentParity(data,new Date('2026-11-18T05:10:00Z')),0);
  assert.equal(currentParity(data,new Date('2026-11-25T05:10:00Z')),1);
  assert.equal(currentParity(data,new Date('2026-12-02T05:10:00Z')),0);
  assert.equal(currentParity({...data,parityWeek:'???'}),null);
});
